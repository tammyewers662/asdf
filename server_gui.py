import tkinter as tk
from tkinter import scrolledtext
import subprocess
import threading
import os
import signal
import socket
from time import sleep

class ServerManager:
    def __init__(self, master):
        self.master = master
        master.title("服务器管理器")
        master.geometry("600x400")

        self.process = None
        self.server_running = False

        # 创建控件
        self.log_area = scrolledtext.ScrolledText(master, wrap=tk.WORD, state='disabled')
        self.log_area.pack(padx=10, pady=10, expand=True, fill='both')

        button_frame = tk.Frame(master)
        button_frame.pack(pady=5)

        self.start_button = tk.Button(button_frame, text="启动服务器", command=self.start_server)
        self.start_button.pack(side=tk.LEFT, padx=5)

        self.restart_button = tk.Button(button_frame, text="重启服务器", command=self.restart_server, state=tk.DISABLED)
        self.restart_button.pack(side=tk.LEFT, padx=5)

        self.stop_button = tk.Button(button_frame, text="停止服务器", command=self.stop_server, state=tk.DISABLED)
        self.stop_button.pack(side=tk.LEFT, padx=5)

        master.protocol("WM_DELETE_WINDOW", self.on_closing)

    def is_port_in_use(self, port: int) -> bool:
        """检查指定端口是否被占用。"""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            return s.connect_ex(('127.0.0.1', port)) == 0

    def log(self, message):
        self.log_area.configure(state='normal')
        self.log_area.insert(tk.END, message + '\n')
        self.log_area.configure(state='disabled')
        self.log_area.see(tk.END)

    def update_button_states(self):
        if self.server_running:
            self.start_button.config(state=tk.DISABLED)
            self.restart_button.config(state=tk.NORMAL)
            self.stop_button.config(state=tk.NORMAL)
        else:
            self.start_button.config(state=tk.NORMAL)
            self.restart_button.config(state=tk.DISABLED)
            self.stop_button.config(state=tk.DISABLED)

    def find_process_using_port(self, port: int):
        """查找并记录占用指定端口的进程信息。"""
        try:
            # 执行 netstat 命令查找使用指定端口的进程PID
            result = subprocess.run(
                ['netstat', '-aon'],
                capture_output=True,
                text=True,
                check=True
            )
            
            pid = None
            # 遍历输出的每一行
            for line in result.stdout.splitlines():
                if f':{port}' in line and 'LISTENING' in line:
                    parts = line.split()
                    pid = parts[-1]
                    break
            
            if pid:
                # 根据PID查找进程名称
                result = subprocess.run(
                    ['tasklist', '/FI', f'PID eq {pid}'],
                    capture_output=True,
                    text=True,
                    check=True
                )
                # 查找进程信息行
                for line in result.stdout.splitlines():
                    if line.startswith('INFO:') or line.strip() == '':
                        continue
                    if pid in line:
                        process_name = line.split()[0]
                        self.log(f"错误: 端口 {port} 已被进程 '{process_name}' (PID: {pid}) 占用。")
                        return
                self.log(f"错误: 端口 {port} 已被 PID 为 {pid} 的进程占用，但无法获取进程名。")
            else:
                self.log(f"错误: 端口 {port} 已被占用，但无法找到具体的进程信息。")

        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            self.log(f"查找占用端口的进程时出错: {e}")
            self.log("请手动检查端口占用情况。")

    def start_server(self):
        if self.server_running:
            self.log("服务器已在运行中。")
            return

        if self.is_port_in_use(3000):
            self.find_process_using_port(3000)
            return

        self.log("正在启动服务器...")
        # 使用 'node' 命令启动 server.js
        # cwd 设置为脚本所在的目录，以确保 server.js 能找到它的数据文件
        script_dir = os.path.dirname(os.path.abspath(__file__))
        self.process = subprocess.Popen(
            ['node', 'server.js'],
            cwd=script_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP # Windows specific
        )
        self.server_running = True
        self.update_button_states()

        # 在单独的线程中读取服务器输出
        threading.Thread(target=self.read_output, args=(self.process.stdout,), daemon=True).start()
        threading.Thread(target=self.read_output, args=(self.process.stderr,), daemon=True).start()
        self.log("服务器已启动。")

    def stop_server(self):
        if not self.server_running or not self.process:
            self.log("服务器未运行。")
            return

        self.log("正在停止服务器...")
        try:
            # 使用 taskkill 命令强制终止进程及其子进程
            subprocess.run(
                ['taskkill', '/F', '/PID', str(self.process.pid), '/T'],
                check=True,
                capture_output=True,
                text=True
            )
            self.log("服务器进程已被终止。")
        except subprocess.CalledProcessError as e:
            self.log(f"停止服务器时出错: {e.stderr}")
        except FileNotFoundError:
            self.log("错误: 'taskkill' 命令未找到。请确保您的系统是Windows。")
        
        self.process = None
        self.server_running = False
        self.update_button_states()
        self.log("服务器已停止。")

    def restart_server(self):
        self.log("正在重启服务器...")
        if self.server_running:
            self.stop_server()
            # 循环检查端口是否已释放，最多等待5秒
            self.log("等待端口释放...")
            for _ in range(50): # 50 * 100ms = 5 seconds
                if not self.is_port_in_use(3000):
                    self.log("端口已释放。")
                    self.master.after(500, self.start_server) # 端口释放后，稍作等待再启动
                    return
                sleep(0.1)
            self.log("错误：端口释放超时。无法重启服务器。")
        else:
            self.start_server()

    def read_output(self, pipe):
        for line in iter(pipe.readline, ''):
            self.log(line.strip())
        pipe.close()

    def on_closing(self):
        if self.server_running:
            self.stop_server()
        self.master.destroy()

if __name__ == "__main__":
    root = tk.Tk()
    app = ServerManager(root)
    root.mainloop()
