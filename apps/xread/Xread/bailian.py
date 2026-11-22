"""Minimal OpenAI-compatible JSON client for Alibaba Cloud Model Studio."""
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


MODELS = ("deepseek-v4.1-flash", "qwen4-max", "kimi-k3.1-pro", "glm-5.3")
AUTO = "auto"
MODEL_CHOICES = (AUTO, *MODELS)
DEFAULT_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"


class GatewayError(ValueError):
    def __init__(self, message, *, switchable=False, auto_switchable=False):
        super().__init__(message)
        self.switchable = switchable
        self.auto_switchable = auto_switchable


class Gateway:
    """Keep using the working model across every call in one job."""

    def __init__(self, key, preferred, on_switch=None, *, current=None):
        self.key = key
        self.automatic = preferred == AUTO
        self.model = current if current in MODELS else (preferred if preferred in MODELS else MODELS[0])
        self.candidates = [model for model in MODELS if model not in (self.model, preferred)]
        self.on_switch = on_switch

    def advance(self, reason):
        if not self.candidates:
            return False
        previous = self.model
        self.model = self.candidates.pop(0)
        if self.on_switch:
            self.on_switch(previous, self.model, str(reason))
        return True

    def complete(self, system, payload, limit, *, required=None):
        while True:
            try:
                result = complete(self.key, self.model, system, payload, limit)
                if required:
                    field, kind = required
                    value = result.get(field)
                    if not isinstance(value, kind) or (kind is str and not value.strip()):
                        raise GatewayError("模型缺少任务所需的输出字段。", auto_switchable=True)
                return result
            except GatewayError as exc:
                if not (exc.switchable or (self.automatic and exc.auto_switchable)):
                    raise
                if not self.advance(exc):
                    raise GatewayError(f"百炼候补模型均未能处理请求。最后一次返回为「{exc}」") from None


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
        "response_format": {"type": "json_object"},
    }
    if model != "glm-5.3":
        body["enable_thinking"] = False
    req = Request(endpoint(), json.dumps(body).encode(),
                  {"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with build_opener(NoRedirect()).open(req, timeout=110) as response:
            reply = json.loads(response.read(512 * 1024))
        choice = reply["choices"][0]
        finish = choice.get("finish_reason")
        if finish in ("content_filter", "sensitive"):
            raise GatewayError("百炼未返回正文，提示内容已被过滤。")
        if finish != "stop":
            raise GatewayError("网关输出被截断或未完成。", auto_switchable=True)
        content = json.loads(choice["message"]["content"])
        if not isinstance(content, dict):
            raise ValueError
        return content
    except GatewayError:
        raise
    except HTTPError as exc:
        code = ""
        try:
            data = json.loads(exc.read(8192))
            data = data.get("error", data)
            code = data.get("code", "")
        except (OSError, ValueError, AttributeError):
            pass
        error = {401: "百炼拒绝了这个 API Key。", 403: "百炼拒绝当前模型请求（HTTP 403）。",
                 404: "此模型在当前百炼区域不可用（HTTP 404）。",
                 429: "百炼额度或调用频率达到限制（HTTP 429）。"}
        if code == "AllocationQuota.FreeTierOnly":
            error[403] = "当前百炼账户仅允许使用免费额度，百炼拒绝了该模型请求。"
        switchable = exc.code in (403, 404, 429, 502, 503, 504) or code in ("ModelNotFound", "InvalidModel")
        raise GatewayError(error.get(exc.code, f"百炼请求失败（HTTP {exc.code}）。"),
                           switchable=switchable) from None
    except TimeoutError:
        raise GatewayError("百炼模型响应超时。", auto_switchable=True) from None
    except (URLError, OSError):
        raise GatewayError("连接百炼中断，请稍后重试。", auto_switchable=True) from None
    except (ValueError, IndexError, KeyError, TypeError):
        raise GatewayError("百炼返回的数据不符合 JSON 格式。", auto_switchable=True) from None
