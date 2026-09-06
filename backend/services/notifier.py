import logging
import httpx
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

async def send_wechat_notification(
    title: str,
    content_md: str,
    channel: str = "serverchan",
    secret_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Send WeChat notification via ServerChan, PushPlus, or Enterprise WeChat Webhook.
    """
    if not secret_key or not secret_key.strip():
        return {"status": "failed", "detail": "未配置推送密钥或 Webhook 地址"}

    channel = (channel or "serverchan").lower().strip()
    secret_key = secret_key.strip()

    # Limit message body size if necessary for WeChat platforms (e.g. 4000 chars)
    if len(content_md) > 4000:
        content_md = content_md[:3900] + "\n\n...(内容较长，已自动省略截断)"

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            if channel == "serverchan":
                # Server酱 Turbo API: https://sctapi.ftqq.com/{SendKey}.send
                url = f"https://sctapi.ftqq.com/{secret_key}.send"
                payload = {"title": title, "desp": content_md}
                res = await client.post(url, data=payload)
                data = res.json()
                if res.status_code == 200 and data.get("code") == 0:
                    return {"status": "success", "message": "Server酱 微信消息推送成功！"}
                else:
                    msg = data.get("message") or data.get("errmsg") or res.text
                    return {"status": "failed", "detail": f"Server酱 推送失败: {msg}"}

            elif channel == "pushplus":
                # PushPlus API: http://www.pushplus.plus/send
                url = "http://www.pushplus.plus/send"
                payload = {
                    "token": secret_key,
                    "title": title,
                    "content": content_md,
                    "template": "markdown"
                }
                res = await client.post(url, json=payload)
                data = res.json()
                if res.status_code == 200 and data.get("code") == 200:
                    return {"status": "success", "message": "PushPlus 微信消息推送成功！"}
                else:
                    msg = data.get("msg") or res.text
                    return {"status": "failed", "detail": f"PushPlus 推送失败: {msg}"}

            elif channel == "wechat_work":
                # 企业微信机器人 Webhook
                url = secret_key if secret_key.startswith("http") else f"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={secret_key}"
                payload = {
                    "msgtype": "markdown",
                    "markdown": {
                        "content": f"## {title}\n\n{content_md}"
                    }
                }
                res = await client.post(url, json=payload)
                data = res.json()
                if res.status_code == 200 and data.get("errcode") == 0:
                    return {"status": "success", "message": "企业微信机器人 微信消息推送成功！"}
                else:
                    msg = data.get("errmsg") or res.text
                    return {"status": "failed", "detail": f"企业微信机器人 推送失败: {msg}"}

            else:
                return {"status": "failed", "detail": f"不支持的推送通道: {channel}"}

        except Exception as e:
            logger.error(f"WeChat notification send error: {e}")
            return {"status": "failed", "detail": f"网络请求异常: {str(e)}"}
