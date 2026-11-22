"""Minimal OpenAI-compatible JSON client for Alibaba Cloud Model Studio."""
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


MODELS = ("qwen3.8-max-0902", "deepseek-v4.1-flash-1017", "deepseek-v4.1-flash",
          "qwen4-max", "kimi-k3.1-pro", "glm-5.3")
DEFAULT_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"


class GatewayError(ValueError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def configured_key():
    try:
        path = os.environ.get("XREAD_BAILIAN_KEY_FILE")
        value = os.environ.get("DASHSCOPE_API_KEY") or (
            Path(path).read_text(encoding="utf-8-sig").strip() if path else "")
    except (OSError, UnicodeError):
        return ""
    return value if re.fullmatch(r"[!-~]{8,8192}", value) else ""


def endpoint():
    base = os.environ.get("DASHSCOPE_BASE_URL", DEFAULT_BASE).rstrip("/")
    url = urlsplit(base)
    legacy = {"dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com",
              "cn-hongkong.dashscope.aliyuncs.com"}
    if (url.scheme != "https" or url.username or url.password or url.query or url.fragment
            or url.port not in (None, 443) or url.path != "/compatible-mode/v1"
            or (url.hostname not in legacy and not re.fullmatch(r"[a-z0-9-]+\.(?:cn-beijing|cn-hongkong|ap-southeast-1)\.maas\.aliyuncs\.com", url.hostname or ""))):
        raise GatewayError("百炼服务地址配置无效。")
    return base + "/chat/completions"


def complete(key, model, system, payload, limit):
    if not isinstance(key, str) or not re.fullmatch(r"[!-~]{8,8192}", key):
        raise GatewayError("请填写有效的百炼 API Key。")
    if model not in MODELS:
        raise GatewayError("请选择列表中的百炼模型。")
    body = {
        "model": model, "stream": False, "max_tokens": limit,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        "response_format": {"type": "json_object"}, "enable_thinking": False,
    }
    req = Request(endpoint(), json.dumps(body).encode(),
                  {"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with build_opener(NoRedirect()).open(req, timeout=110) as response:
            reply = json.loads(response.read(512 * 1024))
        choice = reply["choices"][0]
        if choice.get("finish_reason") != "stop":
            raise GatewayError("网关输出被截断或未完成。可换模型后重试。")
        content = json.loads(choice["message"]["content"])
        if not isinstance(content, dict):
            raise ValueError
        return content
    except GatewayError:
        raise
    except HTTPError as exc:
        error = {401: "百炼拒绝了这个 API Key。", 403: "当前百炼账号可能未开通此模型或无权调用。",
                 404: "此模型在当前百炼区域不可用。", 429: "百炼额度或调用频率达到限制。"}
        raise GatewayError(error.get(exc.code, f"百炼请求失败（HTTP {exc.code}）。可换模型后重试。")) from None
    except (URLError, TimeoutError, OSError):
        raise GatewayError("连接百炼超时或中断，请稍后重试。") from None
    except (ValueError, IndexError, KeyError, TypeError):
        raise GatewayError("百炼返回的数据不符合 JSON 格式。可换模型后重试。") from None
