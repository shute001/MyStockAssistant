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
            "category": "MID_TERM",
            "description": "基于威廉·欧奈尔 CANSLIM 系统，专注高相对强度(RS)与形态放量突破，坚决设7%无条件止损。",
            "content": "【顶级战法: 欧奈尔 CANSLIM 突破战法】1. 仅买入相对强度 RS>80 且形成放量突破（放量>50%）箱体或杯柄形态的标的；2. 严格执行 7% 无条件硬止损；3. 盈利达 20% 前不轻易止盈；4. 大盘处于下跌趋势时空仓或轻仓防守。",
            "importance": 5
        },
        {
            "id": "LEADER_DIVERGENCE_DIP",
            "name": "🚀 主线龙头与分歧低吸战法",
            "category": "SHORT_TERM",
            "description": "聚焦 A 股市场当期成交量前两名的核心主线题材，只在分歧日缩量低吸龙头股，拒绝跟风后排。",
            "content": "【顶级战法: 主线龙头分歧低吸战法】1. 严格锁定全市场当期热点与资金流向排名前二的主线题材；2. 绝不在加速连板日追高，仅在主线分歧缩量回踩 5日/10日均线确认支撑时低吸；3. 坚决不上车无题材支撑的后排跟风股票。",
            "importance": 5
        },
        {
            "id": "MA_TREND_PULLBACK",
            "name": "📈 均线多头与趋势回踩战法",
            "category": "MID_TERM",
            "description": "右侧顺势交易，要求 MA5/10/20 均线多头排列且零轴上方 MACD 金叉，仅在回踩 20 日线时分批建仓。",
            "content": "【顶级战法: 均线多头趋势回踩战法】1. 买入前提：日 K 线 MA5 > MA10 > MA20 多头排列，且 MACD 运行于零轴上方；2. 最佳买点：缩量回踩 20 日均线不破且出现止跌 K 线时分批建仓；3. 跌破 20 日均线且 3 日内无法收复则止损。",
            "importance": 5
        },
        {
            "id": "HIGH_DIVIDEND_DEFENSE",
            "name": "🛡️ PB-ROE 高股息防御战法",
            "category": "LONG_TERM",
            "description": "防御型价值战法，挑选股息率>5%、自由现金流充沛的红利标的，在股息分红季前低估值配置。",
            "content": "【顶级战法: PB-ROE 高股息防御战法】1. 选股标准：股息率 > 5%，近三年 ROE > 12%，资产负债率可控且自由现金流充沛；2. 交易买点：股价位于历史估值低位分批逢低吸纳；3. 卖出信号：股息率因股价暴涨降至 3% 以下或基本面恶化。",
            "importance": 5
        },
        {
            "id": "ETF_GRID_DYNAMIC",
            "name": "🌐 宽基/行业 ETF 均线动态网格战法",
            "category": "ETF_FUND",
            "description": "针对指数与行业 ETF 的逆向定投与高抛低吸网格，克服追涨杀跌，越跌越买，越涨越卖。",
            "content": "【顶级战法: 宽基/行业 ETF 动态网格战法】1. 标的选择：首选沪深300、科创50、中证A500、恒生科技等高流动性核心宽基或高成长行业ETF；2. 网格构建：以 MA20 为中轴，每下跌 3%~5% 加仓一档（定投分批建仓），每反弹 5% 减仓对应档位兑现收益；3. 严禁追高：偏离 MA20 超过 10% 坚决停止加仓。",
            "importance": 5
        },
        {
            "id": "ETF_SECTOR_ROTATION",
            "name": "📊 行业景气度 ETF 动量轮动战法",
            "category": "ETF_FUND",
            "description": "聚焦 A 股当期政策催化与景气度上行的领涨行业 ETF，20日均线上方持股，破位轮动调仓。",
            "content": "【顶级战法: 行业景气度 ETF 轮动战法】1. 筛选条件：跟踪申万一级行业近20日成交额与涨幅前15%的领头行业ETF；2. 买入条件：日 K 线站上 20 日均线且 MACD 零轴上方放量金叉；3. 轮动调仓：跌破 20 日均线或领涨动量被新主线替代时，切换调仓至新领涨ETF。",
            "importance": 5
        }
    ]

    CATEGORY_LABELS = {
        "SHORT_TERM": "⚡ 股票短线",
        "MID_TERM": "📈 股票中线",
        "LONG_TERM": "🛡️ 股票长线",
        "ETF_FUND": "🌐 ETF与基金",
        "GENERAL": "⚖️ 通用风控"
    }

    @classmethod
    def infer_category(cls, content: str, memory_type: Optional[str] = None) -> str:
        """Intelligently infer strategy category based on keywords"""
        c = (content or "").lower()
        if any(kw in c for kw in ["etf", "基金", "网格", "宽基", "定投", "指数", "科创50", "沪深300", "中证", "恒生", "纳指"]):
            return "ETF_FUND"
        if any(kw in c for kw in ["股息", "红利", "roe", "长线", "价值", "分红", "现金流", "低估值", "重仓持有"]):
            return "LONG_TERM"
        if any(kw in c for kw in ["短线", "超短", "龙头", "打板", "竞价", "分歧", "连板", "反包", "低吸", "龙回头", "弱转强", "日内"]):
            return "SHORT_TERM"
        if any(kw in c for kw in ["中线", "波段", "均线", "趋势", "ma20", "ma60", "周线", "canslim", "箱体", "多头排列", "回踩"]):
            return "MID_TERM"
        if any(kw in c for kw in ["风控", "止损", "仓位", "回撤", "心态", "情绪", "纪律", "原则", "知行合一"]):
            return "GENERAL"
        return "SHORT_TERM"

    @classmethod
    def get_all_memories(cls, db: Session, limit: int = 50, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetch all stored memories for TradeReviewAgent with optional category filtering"""
        query = db.query(AgentMemory).filter(AgentMemory.agent_name == cls.AGENT_NAME)
        if category and category != "ALL":
            query = query.filter(AgentMemory.category == category)

        memories = query.order_by(AgentMemory.importance.desc(), AgentMemory.updated_at.desc()).limit(limit).all()

        results = []
        for m in memories:
            actual_cat = m.category or cls.infer_category(m.content)
            results.append({
                "id": m.id,
                "memory_type": m.memory_type,
                "category": actual_cat,
                "category_label": cls.CATEGORY_LABELS.get(actual_cat, "⚡ 股票短线"),
                "content": m.content,
                "importance": m.importance,
                "source_info": m.source_info,
                "created_at": m.created_at.strftime("%Y-%m-%d %H:%M:%S") if m.created_at else "",
                "updated_at": m.updated_at.strftime("%Y-%m-%d %H:%M:%S") if m.updated_at else ""
            })
        return results

    @classmethod
    def format_memories_for_prompt(cls, db: Session, target_symbol: Optional[str] = None) -> str:
        """Format memories into a structured text prompt block with contextual prioritization for ETF vs Stocks"""
        memories = cls.get_all_memories(db, limit=50)
        if not memories:
            return "（暂无历史认知与筛选规则积累。请认真观察用户的交易行为与选股偏好并萃取规则。）"

        is_etf = False
        if target_symbol:
            s_clean = target_symbol.strip()
            if any(s_clean.startswith(prefix) for prefix in ["51", "15", "58", "56", "16"]):
                is_etf = True

        lines = ["## 🧠 Agent 核心指导思想与【分类实战战法与规则库】:"]
        
        if is_etf:
            lines.append("【特别提示】: 当前研判标的为【ETF/指数基金】，必须严格对标《🌐 ETF与基金网格定投战法》与《⚖️ 通用风控》，坚决禁止套用个股短线打板或追高逻辑！\n")

        # Group by categories
        grouped: Dict[str, List[Dict[str, Any]]] = {
            "ETF_FUND": [],
            "SHORT_TERM": [],
            "MID_TERM": [],
            "LONG_TERM": [],
            "GENERAL": []
        }
        for m in memories:
            cat = m.get("category", "SHORT_TERM")
            if cat not in grouped:
                cat = "SHORT_TERM"
            grouped[cat].append(m)

        # Order of categories: if ETF, prioritize ETF_FUND then GENERAL; else SHORT, MID, LONG, GENERAL, ETF
        cat_order = ["ETF_FUND", "GENERAL", "MID_TERM", "LONG_TERM", "SHORT_TERM"] if is_etf else ["SHORT_TERM", "MID_TERM", "LONG_TERM", "ETF_FUND", "GENERAL"]

        for cat_key in cat_order:
            cat_list = grouped.get(cat_key, [])
            if not cat_list:
                continue
            cat_label = cls.CATEGORY_LABELS.get(cat_key, cat_key)
            lines.append(f"=== {cat_label} (共 {len(cat_list)} 条) ===")
            for idx, m in enumerate(cat_list, 1):
                prio_tag = " [🏆 顶尖战法]" if m["memory_type"] == "MASTER_PLAYBOOK" else ""
                lines.append(f"{idx}. {m['content']}{prio_tag} (重要度:{m['importance']}/5, 来源:{m['source_info']})")
            lines.append("")

        return "\n".join(lines).strip()

    @classmethod
    def add_memory(
        cls, 
        db: Session, 
        content: str, 
        memory_type: str = "USER_HABIT", 
        importance: int = 3, 
        source_info: Optional[str] = None,
        category: Optional[str] = None
    ) -> AgentMemory:
        """Manually or automatically insert a new memory item with intelligent categorization"""
        actual_category = category or cls.infer_category(content, memory_type)

        existing = db.query(AgentMemory).filter(
            AgentMemory.agent_name == cls.AGENT_NAME,
            AgentMemory.content == content.strip()
        ).first()

        if existing:
            existing.importance = max(existing.importance, importance)
            existing.memory_type = memory_type
            if category:
                existing.category = category
            elif not existing.category:
                existing.category = actual_category
            existing.updated_at = bj_now()
            db.commit()
            return existing

        new_mem = AgentMemory(
            agent_name=cls.AGENT_NAME,
            memory_type=memory_type,
            category=actual_category,
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

    @classmethod
    async def audit_and_optimize(cls, db: Session) -> Dict[str, Any]:
        """Audit all memories and generate optimization & pruning plan"""
        from services.llm_engine import MultiLLMEngine
        memories = cls.get_all_memories(db, limit=100)
        return await MultiLLMEngine.audit_and_optimize_memories(db, memories)

    @classmethod
    def apply_optimization(
        cls, 
        db: Session, 
        delete_ids: List[int], 
        merged_items: Optional[List[Dict[str, Any]]] = None,
        enhanced_items: Optional[List[Dict[str, Any]]] = None,
        recommended_items: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Apply approved pruning, enhancements, additions and merged rules to DB"""
        deleted_count = 0
        if delete_ids:
            deleted_count = db.query(AgentMemory).filter(AgentMemory.id.in_(delete_ids)).delete(synchronize_session=False)

        enhanced_count = 0
        if enhanced_items:
            for item in enhanced_items:
                mid = item.get("id")
                new_text = item.get("enhanced_content", "").strip()
                if mid and new_text:
                    mem = db.query(AgentMemory).filter(AgentMemory.id == mid).first()
                    if mem:
                        mem.content = new_text
                        mem.importance = max(mem.importance, 4)
                        mem.memory_type = "MASTER_PLAYBOOK"
                        if item.get("category"):
                            mem.category = item["category"]
                        elif not mem.category:
                            mem.category = cls.infer_category(new_text)
                        mem.updated_at = bj_now()
                        enhanced_count += 1

        added_merged_count = 0
        if merged_items:
            for item in merged_items:
                orig_ids = item.get("original_ids", [])
                if orig_ids:
                    db.query(AgentMemory).filter(AgentMemory.id.in_(orig_ids)).delete(synchronize_session=False)
                new_content = item.get("new_content", "").strip()
                if new_content:
                    cls.add_memory(
                        db=db,
                        content=new_content,
                        memory_type=item.get("memory_type", "MASTER_PLAYBOOK"),
                        importance=item.get("importance", 5),
                        source_info=item.get("source_info", "AI战法提纯整合"),
                        category=item.get("category")
                    )
                    added_merged_count += 1

        added_recommended_count = 0
        if recommended_items:
            for item in recommended_items:
                r_content = item.get("content", "").strip()
                if r_content:
                    cls.add_memory(
                        db=db,
                        content=r_content,
                        memory_type="MASTER_PLAYBOOK",
                        importance=5,
                        source_info=item.get("source_info", "全网热门战法补充"),
                        category=item.get("category")
                    )
                    added_recommended_count += 1

        db.commit()
        remaining_count = db.query(AgentMemory).filter(AgentMemory.agent_name == cls.AGENT_NAME).count()
        return {
            "status": "success",
            "deleted_count": deleted_count,
            "enhanced_count": enhanced_count,
            "added_merged_count": added_merged_count,
            "added_recommended_count": added_recommended_count,
            "remaining_count": remaining_count,
            "message": f"成功淘汰清理 {deleted_count} 条噪音，升级优化 {enhanced_count} 条已有经验，补充收录 {added_recommended_count} 条网络热门有效战法，提炼 {added_merged_count} 条标准化战法，经验库当前精简升级为 {remaining_count} 条高质量实战战法！"
        }


