import json
import logging
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from database import AgentMemory, bj_now

logger = logging.getLogger(__name__)

class AgentMemoryService:
    """Service managing LLM Agent Long-Term Memory & Continuous Learning Evolution"""

    AGENT_NAME = "TradeReviewAgent"

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
        """Format memories into a structured text prompt block for LLM system prompt injection"""
        memories = cls.get_all_memories(db, limit=30)
        if not memories:
            return "（暂无历史认知与筛选规则积累。请认真观察用户的交易行为与选股偏好并萃取规则。）"

        lines = ["## 🧠 Agent 已掌握的用户习惯、经验与【选股/建仓规则库】:"]
        for idx, m in enumerate(memories, 1):
            m_type = m["memory_type"]
            if m_type == "SCREENING_RULE":
                type_label = "【选股与筛选规则】"
            elif m_type == "POSITION_RULE":
                type_label = "【建仓/风控规则】"
            elif m_type == "LESSON_LEARNED":
                type_label = "【教训总结】"
            elif m_type == "TRADING_STYLE":
                type_label = "【交易风格】"
            else:
                type_label = "【交易偏好/习惯】"

            lines.append(f"{idx}. {type_label} (重要度:{m['importance']}/5): {m['content']} [来源: {m['source_info']}]")

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

