import json
import logging
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from database import AgentMemory, bj_now

logger = logging.getLogger(__name__)

class AgentMemoryService:
    """Service managing LLM Agent Long-Term Memory & Continuous Learning Evolution"""

    AGENT_NAME = "TradeReviewAgent"

    PRESET_PLAYBOOKS = [
        {
            "id": "CANSLIM_BREAKOUT",
            "name": "🏆 欧奈尔 CANSLIM / 趋势突破战法",
            "description": "基于威廉·欧奈尔 CANSLIM 系统，专注高相对强度(RS)与形态放量突破，坚决设7%无条件止损。",
            "content": "【顶级战法: 欧奈尔 CANSLIM 突破战法】1. 仅买入相对强度 RS>80 且形成放量突破（放量>50%）箱体或杯柄形态的标的；2. 严格执行 7% 无条件硬止损；3. 盈利达 20% 前不轻易止盈；4. 大盘处于下跌趋势时空仓或轻仓防守。",
            "importance": 5
        },
        {
            "id": "LEADER_DIVERGENCE_DIP",
            "name": "🚀 主线龙头与分歧低吸战法",
            "description": "聚焦 A 股市场当期成交量前两名的核心主线题材，只在分歧日缩量低吸龙头股，拒绝跟风后排。",
            "content": "【顶级战法: 主线龙头分歧低吸战法】1. 严格锁定全市场当期热点与资金流向排名前二的主线题材；2. 绝不在加速连板日追高，仅在主线分歧缩量回踩 5日/10日均线确认支撑时低吸；3. 坚决不上车无题材支撑的后排跟风股票。",
            "importance": 5
        },
        {
            "id": "MA_TREND_PULLBACK",
            "name": "📈 均线多头与趋势回踩战法",
            "description": "右侧顺势交易，要求 MA5/10/20 均线多头排列且零轴上方 MACD 金叉，仅在回踩 20 日线时分批建仓。",
            "content": "【顶级战法: 均线多头趋势回踩战法】1. 买入前提：日 K 线 MA5 > MA10 > MA20 多头排列，且 MACD 运行于零轴上方；2. 最佳买点：缩量回踩 20 日均线不破且出现止跌 K 线时分批建仓；3. 跌破 20 日均线且 3 日内无法收复则止损。",
            "importance": 5
        },
        {
            "id": "HIGH_DIVIDEND_DEFENSE",
            "name": "🛡️ PB-ROE 高股息防御战法",
            "description": "防御型价值战法，挑选股息率>5%、自由现金流充沛的红利标的，在股息分红季前低估值配置。",
            "content": "【顶级战法: PB-ROE 高股息防御战法】1. 选股标准：股息率 > 5%，近三年 ROE > 12%，资产负债率可控且自由现金流充沛；2. 交易买点：股价位于历史估值低位分批逢低吸纳；3. 卖出信号：股息率因股价暴涨降至 3% 以下或基本面恶化。",
            "importance": 5
        }
    ]

    @classmethod
    def get_all_memories(cls, db: Session, limit: int = 50) -> List[Dict[str, Any]]:
        """Fetch all stored memories for TradeReviewAgent"""
        memories = db.query(AgentMemory).filter(
            AgentMemory.agent_name == cls.AGENT_NAME
        ).order_by(AgentMemory.importance.desc(), AgentMemory.updated_at.desc()).limit(limit).all()

        results = []
        for m in memories:
            results.append({
                "id": m.id,
                "memory_type": m.memory_type,
                "content": m.content,
                "importance": m.importance,
                "source_info": m.source_info,
                "created_at": m.created_at.strftime("%Y-%m-%d %H:%M:%S") if m.created_at else "",
                "updated_at": m.updated_at.strftime("%Y-%m-%d %H:%M:%S") if m.updated_at else ""
            })
        return results

    @classmethod
    def format_memories_for_prompt(cls, db: Session) -> str:
        """Format memories into a structured text prompt block with MASTER_PLAYBOOK prioritized"""
        memories = cls.get_all_memories(db, limit=40)
        if not memories:
            return "（暂无历史认知与筛选规则积累。请认真观察用户的交易行为与选股偏好并萃取规则。）"

        playbooks = [m for m in memories if m["memory_type"] == "MASTER_PLAYBOOK"]
        other_mems = [m for m in memories if m["memory_type"] != "MASTER_PLAYBOOK"]

        lines = ["## 🧠 Agent 核心指导思想与【顶尖交易战法与规则库 (Master Playbooks)】:"]
        if playbooks:
            lines.append("=== 🏆 必须严格对标与恪守的【顶级战法与规则】 (最高优先级) ===")
            for idx, m in enumerate(playbooks, 1):
                lines.append(f"{idx}. {m['content']} [权重:{m['importance']}/5, 来源:{m['source_info']}]")
        else:
            lines.append("（尚未激活顶尖战法卡片，建议提示用户在界面中一键激活 CANSLIM/龙头低吸/均线趋势战法）")

        if other_mems:
            lines.append("\n=== 📌 个人历史习惯、教训与经验积累 ===")
            for idx, m in enumerate(other_mems, 1):
                lines.append(f"{idx}. [{m['memory_type']}] {m['content']} (重要度:{m['importance']}/5)")

        return "\n".join(lines)

    @classmethod
    def add_memory(
        cls, 
        db: Session, 
        content: str, 
        memory_type: str = "USER_HABIT", 
        importance: int = 3, 
        source_info: Optional[str] = None
    ) -> AgentMemory:
        """Manually or automatically insert a new memory item"""
        # Deduplicate memory if exact content exists
        existing = db.query(AgentMemory).filter(
            AgentMemory.agent_name == cls.AGENT_NAME,
            AgentMemory.content == content.strip()
        ).first()

        if existing:
            existing.importance = max(existing.importance, importance)
            existing.memory_type = memory_type
            existing.updated_at = bj_now()
            db.commit()
            return existing

        new_mem = AgentMemory(
            agent_name=cls.AGENT_NAME,
            memory_type=memory_type,
            content=content.strip(),
            importance=importance,
            source_info=source_info or "AI自动进化提炼",
            created_at=bj_now(),
            updated_at=bj_now()
        )
        db.add(new_mem)
        db.commit()
        db.refresh(new_mem)
        return new_mem

    @classmethod
    def delete_memory(cls, db: Session, memory_id: int) -> bool:
        """Delete a memory item from DB"""
        mem = db.query(AgentMemory).filter(AgentMemory.id == memory_id).first()
        if mem:
            db.delete(mem)
            db.commit()
            return True
        return False

    @classmethod
    def auto_extract_and_evolve(cls, db: Session, review_text: str, source_label: str = "每日交易复盘"):
        """
        Parse review report text or chat transcript to extract key learning takeaways & rules,
        auto-saving to memory bank with intelligent classification.
        """
        try:
            extracted_count = 0
            lines = review_text.split("\n")
            in_memory_section = False

            for line in lines:
                line_str = line.strip()
                if any(kw in line_str for kw in ["动态演化总结", "进化提炼", "Agent 学习认知", "选股规则", "建仓规则"]):
                    in_memory_section = True
                    continue

                if in_memory_section:
                    if line_str.startswith("#"):
                        in_memory_section = False
                        continue
                    
                    if line_str.startswith("-") or line_str.startswith("*") or (len(line_str) > 3 and line_str[0].isdigit() and line_str[1] in [".", "、"]):
                        clean_text = line_str.lstrip("-*0123456789.、 ").strip()
                        if len(clean_text) >= 5:
                            mem_type = "USER_HABIT"
                            if any(kw in clean_text for kw in ["选股", "筛选", "指标", "金叉", "多头"]):
                                mem_type = "SCREENING_RULE"
                            elif any(kw in clean_text for kw in ["建仓", "止损", "仓位", "风控", "平仓"]):
                                mem_type = "POSITION_RULE"
                            elif any(kw in clean_text for kw in ["教训", "避免", "错误", "切忌"]):
                                mem_type = "LESSON_LEARNED"
                            elif any(kw in clean_text for kw in ["风格", "偏好", "偏爱"]):
                                mem_type = "TRADING_STYLE"

                            cls.add_memory(
                                db=db,
                                content=clean_text,
                                memory_type=mem_type,
                                importance=4,
                                source_info=source_label
                            )
                            extracted_count += 1

            logger.info(f"Agent Memory Evolution completed: extracted {extracted_count} memory items.")
        except Exception as e:
            logger.error(f"Failed to auto extract memory: {e}")

