#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从客户《小红书违禁词》PDF 生成结构化词表 lib/compliance-dict.json

为什么要脚本而不是手敲：
  1. 客户随时会补新词（确认文档最后一句就是「之后补充新的禁用词发给我们」），
     手敲的词表没法证明「跟 PDF 一致」，脚本可以重跑 + diff。
  2. PDF 的文字流是排版顺序，断行断在词中间（「HPV 感 / 染」），
     必须按「、」「，」重切，人工抄容易漏。

用法：
  python3 scripts/build-compliance-dict.py            # 重算并写 lib/compliance-dict.json
  python3 scripts/build-compliance-dict.py --check    # 只比对，不写（CI 用）

依赖：pypdf（pip install pypdf）
"""
import json
import os
import re
import sys
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PDF = os.path.join(ROOT, '..', 'CosmoBounty', 'knowledge', 'cosmobounty', '小红书违禁词.pdf')
OUT = os.path.join(ROOT, 'lib', 'compliance-dict.json')

# ---------------------------------------------------------------- 分类
# 客户清单本身不分类，只给一个「功效不得包含」的大列表 + 七个提示字。
# 分类是为了让审核的人知道「这个词踩的是哪条线」，方便决定改还是删。
CATS = {
    'disease':  '疾病与症状',
    'medical':  '医疗行为与诊疗科目',
    'drug':     '药品与药用成分',
    'efficacy': '功效宣称',
    'exam':     '检查与器械',
    'form':     '外用形态',
    'sexual':   '性与丰胸壮阳',
    'other':    '其他易混淆表述',
}

CAT_MAP = {}
def _reg(cat, words):
    for w in words:
        CAT_MAP[w] = cat

_reg('disease', '''痛经 头痛 腹痛 哮喘 支气管炎 消化不良 痤疮 湿疹 脚气 脚癣 牛皮癣 丘疹
    毛囊炎 酒糟鼻 冻疮 红肿 关节痛 关节炎 关节疼痛 关节肿胀 关节僵硬 肿瘤 癌症 癌细胞
    肝癌 甲肝 乙肝 肝炎 痛风 肾结石 腹泻 近视眼 老花眼 眼部感染 骨质疏松 龋齿 肥胖症
    皮肤病 毛囊角化 心脏病 心血管疾病 心脑血管疾病 酒精肝 代谢综合征 代谢综合征症状
    卵巢早衰 妇科疾病 妇科健康 性传播感染 HPV感染 私处瘙痒 白带异常 月经前综合症疼痛
    缺铁性贫血 巨幼细胞贫血 恶性贫血 早产 胎儿神经管缺陷 阿尔兹海默症（老年痴呆）
    干眼 厌食 PCOS 三高 高血压/三高 高血糖/三高 高血脂/三高 乳糖不耐 乳糖不耐受
    乳糖不耐症 失眠 心悸 过敏 免疫病 炎症 伤风感冒 早产 损伤'''.split())

_reg('medical', '''药用 药物 医疗 中医 西医 中西医结合 内科 外科 妇科 五官科 牙科
    男科促睾 治疗 医治 诊治 就诊 疗程 疗效 治愈 治愈率 康复 康复视力 恢复视力
    降低度数 治疗近视 治疗糖尿病 治疗斑秃 治疗腋臭 治疗体臭 治疗阴臭 美容治疗
    防治 防治高血压 预防疾病 抗病 促愈 伤口愈合 生肌 医生 医院自制 手术 注射 化疗
    理疗 整形 3甲 临床 经××例临床观察具有明显效果 保健乳膏 敷贴 患处 中枢神经'''.split())

_reg('drug', '''西药 中药 处方 开方 药方 复方 抗生素 激素 精神药品 放射性药品
    医疗用毒性药品 麻醉 安眠药 抗焦虑药 抗抑郁（症） 吸附铅汞 胎盘组织液
    细胞提取液 干细胞 去除体内毒素'''.split())

_reg('efficacy', '''消炎 抗炎 解毒 抗敏 脱敏 防敏 溶脂 祛瘀 清热解毒 清热袪湿 杀菌
    消毒 抗菌 抑菌 除菌 灭菌 防菌 褪敏 改善过敏现象 延缓更年期 防癌 抗癌 致癌因子
    消除斑点 逐层减退多种色斑 去除黄褐斑 生发 育发 毛发新生 生黑发 脂溢性脱发
    毛囊激活 毛囊寄生虫 细胞再生 细胞增殖 细胞分化 优化细胞结构 促进细胞分裂 靶向
    抗病毒 退烧 退热 止痛 止咳 缓解疼痛 缓解痉挛抽搐 减轻或缓解疾病症状 抑制有害菌
    活血 改善性功能 兴奋性机能 增强性欲 改善勃起功能障碍 助勃 增加性器官的血流量
    无依赖 断根 祖传秘方 口服化妆品 酒精中毒防醉 促进抗炎因子生成 抵抗促炎因子
    机械损伤 烧伤 各器官损伤 病原 病毒抗体 感染 愈合 缺少xx可引起智力发育障碍'''.split())

_reg('exam', '体检 化验 B超 CT 透射 验血'.split())
_reg('medical', '医嘱 三甲 临床 就诊 诊治'.split())
_reg('disease', '''高血压 高血糖 高血脂 降三高 姨妈痛 老年痴呆 抗抑郁 智力发育障碍
    月经前综合症 心脑血管'''.split())
_reg('form', '保健乳膏 敷贴'.split())
_reg('sexual', '补肾壮阳 丰胸美乳 性功能 男科促睾 改善性功能 助勃'.split())

# ---------------------------------------------------------------- 替换建议
# 全部来自客户《违禁词执行确认_20261013》里已列出的「我们建议的写法」，
# 不是我们临时想的词——承诺对外时能指得出依据。
SUGGEST = {
    '抗炎': '（删去该项，不写「抗炎」）',
    '炎症': '血液指标',
    '激素': '（不写这两个字；检测表述：「农残、防腐剂、重金属等四项未检出」）',
    '医生': '专业人士',
    '医嘱': '请先向专业人士确认',
    '复方': '多通路配方／多成分配方',
    '体检': '各项检查',
    '体检指标': '检查结果',
    '失眠': '入睡慢／夜里容易醒／白天犯困',
    '安眠药': '（改写成日常状态描述）',
    '治疗': '（删去，不写功效承诺）',
    '痛经': '经期那几天不舒服',
    '3甲': '（不写医院等级）',
    '临床': '（不写「临床」二字）',
    '口服化妆品': '（删去）',
    '无依赖': '（删去）',
    '过敏': '敏感',
    '抗敏': '舒缓',
    '防敏': '舒缓',
    '脱敏': '舒缓',
    '褪敏': '舒缓',
    '杀菌': '清洁',
    '消毒': '清洁',
    '抗菌': '清洁',
    '抑菌': '清洁',
    '除菌': '清洁',
    '灭菌': '清洁',
    '防菌': '清洁',
    '防癌': '（删去）',
    '抗癌': '（删去）',
    '补肾壮阳': '（删去）',
    '丰胸美乳': '（删去）',
    '活血': '循环',
    '靶向': '（删去）',
    '干细胞': '（删去）',
    '疗效': '使用感受',
    '疗程': '使用周期',
    '治愈': '改善',
    '康复': '状态变好',
    '副作用': '（不写，只写检测项）',
    '高血压': '血压偏高',
    '高血糖': '血糖偏高',
    '高血脂': '血脂偏高',
    '三高': '三项指标',
    '降三高': '（删去，不写调节功效）',
    '降血压': '（删去，不写调节功效）',
    '降血糖': '（删去，不写调节功效）',
    '降血脂': '（删去，不写调节功效）',
    '姨妈痛': '经期那几天不舒服',
    '老年痴呆': '（删去）',
    '抗抑郁': '（删去）',
    '智力发育障碍': '（删去）',
    '心脑血管': '（删去）',
    '综合征': '（删去具体病名）',
}

# ---------------------------------------------------------------- OCR 串行修正
# PDF 文字流把相邻两行拼在一起（「高血压/ / 三高乳糖不耐乳糖不耐受」），
# 直接按顿号切会切出词典里根本查不到的怪词，扫不出来等于漏检。
SPLIT_FIX = {
    '高血压/三高乳糖不耐乳糖不耐受': ['高血压/三高', '乳糖不耐', '乳糖不耐受'],
    '高血糖/三高损伤机械损伤': ['高血糖/三高', '机械损伤'],
    '高血脂/三高抗癌癌症': ['高血脂/三高', '癌症'],
    '抗炎炎症': ['炎症'],
    '心脑血管疾病缺少xx可引起智力发育障碍': ['心脑血管疾病', '缺少xx可引起智力发育障碍'],
    '抗抑郁（症）替代抗焦虑药': ['抗抑郁（症）', '抗焦虑药'],
    '心悸替代安眠药': ['心悸', '安眠药'],
    '感染治愈愈合': ['感染', '愈合'],
    '被称为“口服化妆品”': ['口服化妆品'],
}

# 带斜杠/全角括号的条目在正文里不会原样出现（没人会写「高血压/三高」），
# 不拆就永远扫不出来。拆成主词 + 别名，各自独立成条。
ALIAS = {
    '高血压/三高': ['高血压', '三高'],
    '高血糖/三高': ['高血糖', '三高'],
    '高血脂/三高': ['高血脂', '三高'],
    '降三高（血糖血脂血压）': ['降三高', '三高'],
    '痛经（姨妈痛）': ['痛经', '姨妈痛'],
    '阿尔兹海默症（老年痴呆）': ['阿尔兹海默症', '老年痴呆'],
    '抗抑郁（症）': ['抗抑郁'],
    '月经前综合症疼痛': ['月经前综合症'],
    '缺少xx可引起智力发育障碍': ['智力发育障碍'],
    '心脑血管疾病': ['心脑血管'],
}

# 七类补充（PDF 后半段按「疾病名称 / 疾病症状改善 / 药物名称 / …」再次列举，
# 里面有一批主体清单没出现的词，例如「活血」「抑菌」「体检」「B超」）
EXTRA = '''活血 防敏 中药 抗菌 抑菌 除菌 灭菌 防菌 诊治 就诊 体检 化验 B超 CT
    透射 验血 药方 手术 注射 化疗 理疗 整形 保健乳膏 敷贴 补肾壮阳 丰胸美乳
    干眼 厌食 PCOS 综合征 3甲 三甲 临床 医嘱'''.split()

# 七个提示字：客户确认文档事项 1 说这是「这一类词的共同特征」，
# 不是「带这个字就禁」。所以只做疑似提示（warn），且必须带豁免白名单。
HINT_CHARS = ['科', '诊', '疗', '病', '痛', '毒', '菌']
HINT_ALLOW = ['科普', '科学', '科技', '科研', '学科', '本科', '专科生', '环境科学',
              '科技成果', '科技感', '科学家']

# ---------------------------------------------------------------- 绝对化用语
# 这一批不是客户清单里的，是《广告法》第九条 + 平台通用审核口径。
# 单独存放、默认只 warn，避免把「客户没要求的」当成「客户要求的」去卡稿。
ABSOLUTE = '''最好 最佳 最强 最高级 最低价 最优 最先进 最有效 最安全 最专业
    第一品牌 全国第一 销量第一 排名第一 行业第一 全球第一 世界第一
    顶级 极品 极致 独一无二 史无前例 绝无仅有 万能 包治 百分之百 100%有效
    纯天然 无副作用 绝对安全 永久有效 立竿见影 根治 药到病除 立刻见效'''.split()
# 「最」「第一」本身是高频正常词，只在这些短语上报警，避免「最后」「第一步」误报
ABSOLUTE_ALLOW = ['最后', '最近', '最初', '最终', '最多', '最少', '最低限度',
                  '第一步', '第一时间', '第一天', '第一次', '第一部分', '第一阶段']


def extract(pdf_path):
    from pypdf import PdfReader
    r = PdfReader(pdf_path)
    text = '\n'.join((p.extract_text() or '') for p in r.pages)
    lines = [l.strip() for l in text.split('\n')]
    start = next(i for i, l in enumerate(lines) if l.startswith('药用、'))
    end = next(i for i, l in enumerate(lines) if '痤疮等' in l)
    body = ''.join(lines[start:end + 1]).replace('痤疮等。', '')
    raw = [p.strip().replace(' ', '').replace('\u200b', '')
           for p in re.split(r'[、，,]', body) if p.strip()]
    return raw


def build(pdf_path):
    raw = extract(pdf_path)
    words, dropped = [], []
    # 两阶段：先修 OCR 串行，再把斜杠/括号条目拆成可搜的别名。
    # 分两步是因为串行修正的产物本身还可能是「高血压/三高」这种待拆条目。
    stage1 = []
    for w in raw:
        if w in SPLIT_FIX:
            stage1.extend(SPLIT_FIX[w])
            if len(SPLIT_FIX[w]) > 1:
                dropped.append({'ocr': w, 'fixed': SPLIT_FIX[w]})
        else:
            stage1.append(w)
    for w in stage1:
        words.extend(ALIAS.get(w, [w]))
    words.extend(EXTRA)

    # 去重保序
    seen, uniq = set(), []
    for w in words:
        if w and w not in seen:
            seen.add(w)
            uniq.append(w)

    items = []
    for w in uniq:
        items.append({
            'w': w,
            'cat': CAT_MAP.get(w, 'other'),
            'sug': SUGGEST.get(w, ''),
            'src': '清单' if w in raw or w in SPLIT_FIX else '补充分类',
        })

    return {
        'meta': {
            'name': '小红书违禁词',
            'source': '客户《小红书违禁词》20261013 版 + 《违禁词执行确认》建议写法',
            'customerClaim': 248,
            'count': len(items),
            'builtAt': datetime.datetime.now().strftime('%Y-%m-%d'),
            'note': '客户口径 248 是「整理出的禁用词」总数，含 xx 病 / xx 综合征 这类通配写法；本表按可精确扫描的字面词收录，通配靠 hintChars 兜底。',
        },
        'words': items,
        'hintChars': HINT_CHARS,
        'hintAllow': HINT_ALLOW,
        'absolute': [{'w': w, 'cat': 'absolute', 'sug': '（删去绝对化表述）', 'src': '广告法'} for w in ABSOLUTE],
        'absoluteAllow': ABSOLUTE_ALLOW,
        'cats': CATS,
    }


def main():
    check_only = '--check' in sys.argv
    pdf = DEFAULT_PDF
    if not os.path.exists(pdf):
        print('找不到 PDF：' + pdf, file=sys.stderr)
        print('提示：可用 --pdf <路径> 指定。', file=sys.stderr)
        sys.exit(2)
    for i, a in enumerate(sys.argv):
        if a == '--pdf':
            pdf = sys.argv[i + 1]

    data = build(pdf)
    text = json.dumps(data, ensure_ascii=False, indent=2) + '\n'

    if check_only:
        old = open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
        same = old == text
        print(('词表一致：%d 条' % data['meta']['count']) if same else '词表与 PDF 不一致，需要重跑')
        sys.exit(0 if same else 1)

    open(OUT, 'w', encoding='utf-8').write(text)
    by_cat = {}
    for it in data['words']:
        by_cat[it['cat']] = by_cat.get(it['cat'], 0) + 1
    print('写入 %s' % OUT)
    print('词条 %d 条（客户口径 %d）' % (data['meta']['count'], data['meta']['customerClaim']))
    for k, v in sorted(by_cat.items(), key=lambda x: -x[1]):
        print('  %-9s %-14s %d' % (k, CATS.get(k, ''), v))
    print('提示字 %s ／ 绝对化 %d 条' % (' '.join(HINT_CHARS), len(ABSOLUTE)))


if __name__ == '__main__':
    main()
