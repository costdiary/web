"""개발·간단 운영용 실행 파일: `python run.py`

환경변수 LOCAL_LAUNCH=1 이면(윈도우용 start.bat 이 설정) 비어 있는 포트를 찾아 쓰고,
서버가 뜨면 브라우저를 엽니다. 서버(Docker 등)에서는 설정하지 않으므로 포트는 PORT 그대로입니다.
"""
import os
import socket
import threading
import time
import webbrowser

from app.config import env_bool, env_int, env_str, load_env_file

load_env_file()


def pick_port(host: str, start: int, span: int = 20) -> int:
    """start 부터 비어 있는 첫 포트를 돌려줍니다. 모두 쓰는 중이면 start 를 그대로 돌려줍니다."""
    for port in range(start, start + span):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
            except OSError:
                continue
            return port
    return start


def _open_browser_when_ready(host: str, port: int) -> None:
    for _ in range(100):
        try:
            with socket.create_connection((host, port), timeout=0.3):
                break
        except OSError:
            time.sleep(0.3)
    else:
        return
    webbrowser.open(f"http://{host}:{port}/")


if __name__ == "__main__":
    import uvicorn

    host = env_str("HOST", "127.0.0.1")
    port = env_int("PORT", 8000)
    if env_bool("LOCAL_LAUNCH"):
        port = pick_port(host, port)
        threading.Thread(target=_open_browser_when_ready, args=(host, port), daemon=True).start()
        print(f"\n  Wongaenote is starting at http://{host}:{port}/  (close this window or press Ctrl+C to stop)\n", flush=True)

    # 윈도우 런처(LOCAL_LAUNCH)에서는 파일이 갱신되면 서버가 새 코드로 다시 뜨게 한다(예전엔 옛 코드가 계속 돌았음).
    uvicorn.run("app.main:app", host=host, port=port, log_level="info", server_header=False,
                reload=env_bool("LOCAL_LAUNCH"), reload_dirs=[os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")])
