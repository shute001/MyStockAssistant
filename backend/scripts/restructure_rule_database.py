"""
Rule Database Restructuring Script
Restructures the AgentMemory database from bloated 71 rules down to 24 clean,
deduplicated, high-signal rules across L0 / L1 / L2 layers.
"""
import sys
import os
import json
import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database import SessionLocal, AgentMemory, bj_now

RULES_24 = [
    # ==================== L0 硬拦截层 (10条) ====================
    {
        "code": "L0-01",
        "category": "SHORT_TERM",
        "memory_type": "SCREENING_RULE",
        "importance": 5,
        "source_info": "规则重构 L0-01",
        "content": "【L0硬拦截·追高禁买】严禁盘中盲目追高与高位无量脉冲。短线标的当日涨幅>+5.0%或5日累计>16%或RSI6>78一票否决；中长线及ETF当日涨幅>+2.8%一票否决。但明确豁免两大良性右侧买点：①米勒维尼VCP枢轴突破首日（涨幅+1.8%~+4.5%，量比>1.5）；②均线多头推土机爬升（涨幅+1.0%~+2.5%，日内与MA5乖离率<3%），此两类属于合规右侧启动点，绝不可机械误判为追高！"
    },
    {
        "code": "L0-02",
        "category": "MID_TERM",
        "memory_type": "SCREENING_RULE",
        "importance": 5,
        "source_info": "规则重构 L0-02",
        "content": "【L0硬拦截·周线MA20硬门槛】标的周K线收盘价低于周MA20生命线时，中长线波段与ETF标的绝对一票否决；短线标的仅在极端超跌修复且有放量反包时方可观察。"
    },
    {
        "code": "L0-03",
        "category": "ETF_FUND",
        "memory_type": "POSITION_RULE",
        "importance": 5,
        "source_info": "规则重构 L0-03",
        "content": "【L0硬拦截·卖后回买禁令】对标的历史交割单，凡5个交易日内有SELL卖出记录的标的，若当前拟买入价 ≥ 上次卖出成交价，系统强制拦截，禁止卖飞后追高买回！"
    },
    {
        "code": "L0-04",
        "category": "GENERAL",
        "memory_type": "SCREENING_RULE",
        "importance": 5,
        "source_info": "规则重构 L0-04",
        "content": "【L0硬拦截·黑名单风控闸门】凡处于风控黑名单（违规减持、业绩暴雷、年化波动率失控或连续假突破）的标的，严禁纳入推选与实盘建仓池。"
    },
    {
        "code": "L0-05",
        "category": "GENERAL",
        "memory_type": "POSITION_RULE",
        "importance": 5,
        "source_info": "规则重构 L0-05",
        "content": "【L0硬拦截·盈亏比底线闸门】(首目标价 - 买入价) / (买入价 - 止损价) 计算出的盈亏比 < 1.5 时强制拦截拒绝，拒绝任何胜率低且盈亏比不达标的负期望交易。"
    },
    {
        "code": "L0-06",
        "category": "MID_TERM",
        "memory_type": "POSITION_RULE",
        "importance": 5,
        "source_info": "规则重构 L0-06",
        "content": "【L0硬拦截·生命线破位强制离场】持仓标的日K线收盘有效跌破MA20生命线且3日内未能收复，或直接击穿设定止损价，必须无条件执行纪律止损，严禁把短线做成死扛套牢。"
    },
    {
        "code": "L0-07",
        "category": "SHORT_TERM",
        "memory_type": "SCREENING_RULE",
        "importance": 5,
        "source_info": "规则重构 L0-07",
        "content": "【L0硬拦截·流动性底线门槛】个股近20日日均成交额<2亿元（短线博弈标的<3亿元/中长线<5亿元），或换手率<1.5%的冷门杂毛，一律一票否决，防范无量被困。"
    },
    {
        "code": "L0-08",
        "category": "ETF_FUND",
        "memory_type": "POSITION_RULE",
        "importance": 5,
        "source_info": "规则重构 L0-08",
        "content": "【L0硬拦截·板块集中度上限】同细分行业/板块持仓及拟买入标的不得超过2只；单一高波跨境ETF必须严格设定-3%硬止损，坚决防止单一赛道风险过度暴露。"
    },
    {
        "code": "L0-09",
        "category": "GENERAL",
        "memory_type": "USER_HABIT",
        "importance": 5,
        "source_info": "规则重构 L0-09",
        "content": "【L0硬拦截·理由与交易方向一致性】下单方向必须与核心分析理由严格自洽；严禁分析理由中写明“趋势破位/缩量走弱”却逆向执行买入操作，杜绝情绪化冲动交易。"
    },
    {
        "code": "L0-10",
        "category": "GENERAL",
        "memory_type": "POSITION_RULE",
        "importance": 5,
        "source_info": "规则重构 L0-10",
        "content": "【L0硬拦截·逆大盘退潮总仓位锁定】当大盘主要指数（上证/沪深300/创业板）跌破MA20均线且处于退潮弱势期，总仓位上限强制压缩至30%以下，现金为王，锁定新开仓。"
    },

    # ==================== L1 参数校验层 (7条) ====================
    {
        "code": "L1-01",
        "category": "SHORT_TERM",
        "memory_type": "POSITION_RULE",
        "importance": 4,
        "source_info": "规则重构 L1-01",
        "content": "【L1参数校准·动态务实止盈】短线首目标锚定 min(买入价×1.035, 近期密集压力位)；次目标设为 min(买入价×1.06, 强阻力位)；T+5交易日未达+2%减半，T+10走平无新高果断清仓。"
    },
    {
        "code": "L1-02",
        "category": "GENERAL",
        "memory_type": "POSITION_RULE",
        "importance": 4,
        "source_info": "规则重构 L1-02",
        "content": "【L1参数校准·碎单与整手禁令】单票拟投入金额小于总资产10%时强制一次性建仓，禁止无限拆分几百元碎片仓位；持仓中出现的非100整数倍零碎股当日盘中挂单清零。"
    },
    {
        "code": "L1-03",
        "category": "SHORT_TERM",
        "memory_type": "SCREENING_RULE",
        "importance": 4,
        "source_info": "规则重构 L1-03",
        "content": "【L1参数校准·量能动量验证】突破型买入要求量比 ≥ 1.5x 且换手充分；回踩型低吸买点必须满足缩量（量比 < 1.0x 且回踩均线支撑确立）；不符合量能特征者自动降级为观察。"
    },
    {
        "code": "L1-04",
        "category": "GENERAL",
        "memory_type": "POSITION_RULE",
        "importance": 4,
        "source_info": "规则重构 L1-04",
        "content": "【L1参数校准·大盘温度与动量修正】宽基指数单日大涨>+2.5%时动量追高买点阈值自动收窄一半且建仓延后1日（防次日分歧兑现）；指数破位期单票仓位上限压至总资产8%以内。"
    },
    {
        "code": "L1-05",
        "category": "MID_TERM",
        "memory_type": "POSITION_RULE",
        "importance": 4,
        "source_info": "规则重构 L1-05",
        "content": "【L1参数校准·处置效应矫正机制】浮盈>+15%的主线强势持仓强制触发移动止盈保护并提示加码至标准仓（让利润奔跑）；破位亏损标的严禁主观向下金字塔补仓摊低成本。"
    },
    {
        "code": "L1-06",
        "category": "GENERAL",
        "memory_type": "POSITION_RULE",
        "importance": 4,
        "source_info": "规则重构 L1-06",
        "content": "【L1参数校准·单笔风险上限测算】单笔最大允许风险损失 = (买入价 - 止损价) × 股数；若该损失超过总账户资金的2%，系统自动强制向下缩减拟买入建议股数至安全阈值。"
    },
    {
        "code": "L1-07",
        "category": "SHORT_TERM",
        "memory_type": "USER_HABIT",
        "importance": 4,
        "source_info": "规则重构 L1-07",
        "content": "【L1参数校准·操作周期与持仓时间匹配】买入逻辑标记为“中线波段”则计划持股周期须在20~60个交易日；标记为“短线分歧/脉冲”则持仓严禁超过5~10个交易日，超时强平。"
    },

    # ==================== L2 核心战法与参考层 (7条) ====================
    {
        "code": "L2-01",
        "category": "MID_TERM",
        "memory_type": "MASTER_PLAYBOOK",
        "importance": 5,
        "source_info": "规则重构 L2-01",
        "content": "【L2顶级战法·520均线体系】①金叉突破：MA5上穿MA20且MA20趋势向上，次日放量>1.5x收阳买入，止损设在MA20下方；②回调低吸：缩量回踩MA20生命线企稳不破，再次站上MA5时加仓介入；③趋势离场：收盘有效击破MA20果断清仓。"
    },
    {
        "code": "L2-02",
        "category": "SHORT_TERM",
        "memory_type": "MASTER_PLAYBOOK",
        "importance": 5,
        "source_info": "规则重构 L2-02",
        "content": "【L2顶级战法·龙回头二波战法】标的前期具备连续涨停或>30%的主升浪拉升，缩量回调至MA20或前期箱体顶部（成交量缩至拉升期1/3），当日放量阳线反包确认低吸买点，破MA20严格止损。"
    },
    {
        "code": "L2-03",
        "category": "SHORT_TERM",
        "memory_type": "MASTER_PLAYBOOK",
        "importance": 5,
        "source_info": "规则重构 L2-03",
        "content": "【L2顶级战法·主流赛道核心分歧低吸】聚焦具备中长线产业逻辑驱动的大主线行业核心，绝不在日内加速脉冲日追高，仅在板块分歧、缩量回踩5日/10日均线企稳支撑时低吸核心领军标的。"
    },
    {
        "code": "L2-04",
        "category": "ETF_FUND",
        "memory_type": "MASTER_PLAYBOOK",
        "importance": 5,
        "source_info": "规则重构 L2-04",
        "content": "【L2顶级战法·核心宽基与行业ETF动态网格】以MA20为中轴基准，每下跌3%~5%加仓一档（分批逢低定投），每反弹5%减仓对应档位兑现收益，单档≤总资金5%，偏离MA20>10%坚决停止加仓。"
    },
    {
        "code": "L2-05",
        "category": "LONG_TERM",
        "memory_type": "MASTER_PLAYBOOK",
        "importance": 5,
        "source_info": "规则重构 L2-05",
        "content": "【L2顶级战法·PB-ROE高股息防御战法】专注股息率>5%、近3年ROE>12%、资产负债率可控且自由现金流强劲的红利资产。在历史估值低位分批逢低吸纳，股息率因暴涨降至3%以下或基本面恶化时止盈。"
    },
    {
        "code": "L2-06",
        "category": "GENERAL",
        "memory_type": "LESSON_LEARNED",
        "importance": 4,
        "source_info": "规则重构 L2-06",
        "content": "【L2实战纪律·历史极值底部不交枪】当标的1年价格分位数<10%、KDJ指标J值<10且跌破布林带下轨时，属于极端非理性恐慌砸盘，严禁在恐慌低位割肉交出筹码，等待超跌反弹再行去留抉择。"
    },
    {
        "code": "L2-07",
        "category": "GENERAL",
        "memory_type": "MASTER_PLAYBOOK",
        "importance": 5,
        "source_info": "规则重构 L2-07",
        "content": "【L2核心元规则·代码硬执行胜过人工自律】交易成败的关键不在于懂得多少理论，而在于能否严格执行。凡依赖个人自觉遵守的口头规则一律容易在情绪波动中失效，必须坚决依托系统L0/L1自动化刚性拦截！"
    },
    {
        "code": "L2-08",
        "category": "MID_TERM",
        "memory_type": "MASTER_PLAYBOOK",
        "importance": 5,
        "source_info": "实战战法 L2-08",
        "content": "【L2顶级战法·周线MA5+KDJ(21)低位金叉波段模型】买入条件：KDJ(21,3,3)在50以下低位金叉（月度级别噪音过滤，右侧第一拐点），且股价连续2周收盘站上5周均线（周线级别止跌筑底确立）。持有与离场纪律：只要股价运行在5周均线上方一路拿稳让利润奔跑；若周线收盘跌破5周均线（敏捷波段止盈）或跌破10周生命线（底线止损）果断卖出离场。"
    }
]


def execute_restructuring():
    db = SessionLocal()
    try:
        # 1. Check existing count
        old_count = db.query(AgentMemory).count()
        print(f"Current AgentMemory count: {old_count}")

        # 2. Clear old memories
        deleted_count = db.query(AgentMemory).delete(synchronize_session=False)
        print(f"Deleted {deleted_count} old bloated/duplicate memories.")

        # 3. Insert 24 high-signal clean rules
        now = bj_now()
        inserted_objs = []
        for r in RULES_24:
            mem = AgentMemory(
                agent_name="TradeReviewAgent",
                memory_type=r["memory_type"],
                content=r["content"],
                importance=r["importance"],
                source_info=r["source_info"],
                category=r["category"],
                created_at=now,
                updated_at=now
            )
            inserted_objs.append(mem)

        db.add_all(inserted_objs)
        db.commit()
        print(f"Successfully inserted {len(inserted_objs)} clean, deduplicated rules!")

        # 4. Verification summary
        total_now = db.query(AgentMemory).count()
        print(f"New AgentMemory total count: {total_now}")

        l0_count = sum(1 for r in RULES_24 if r['code'].startswith('L0'))
        l1_count = sum(1 for r in RULES_24 if r['code'].startswith('L1'))
        l2_count = sum(1 for r in RULES_24 if r['code'].startswith('L2'))
        print(f"Breakdown: L0={l0_count}, L1={l1_count}, L2={l2_count}")

    except Exception as e:
        db.rollback()
        print(f"Failed to restructure rules: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    execute_restructuring()

