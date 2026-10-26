// 出题输出格式的唯一事实源：自查出题（selfcheck）与再次测验（quiz）共用同一套样例与核对清单。
// 之前两处各写一份样例，其中 quiz 的样例还带了 "A." 前缀、与「不要带字母前缀」的规则自相矛盾，
// 模型只能二选一，于是反复在小字段上犯错。
export const QUESTION_OUTPUT_SAMPLE = `[
  {"type": "single", "prompt": "题干", "options": ["选项文本1", "选项文本2", "选项文本3", "选项文本4"], "answer": "B", "explanation": "为什么 B 对、其余错"},
  {"type": "single", "prompt": "题干", "options": ["选项文本1", "选项文本2", "选项文本3", "选项文本4"], "answer": "D", "explanation": "为什么 D 对、其余错"},
  {"type": "judge", "prompt": "一句可判断真假的陈述", "answer": "对", "explanation": "判断依据"},
  {"type": "judge", "prompt": "一句可判断真假的陈述", "answer": "错", "explanation": "判断依据"},
  {"type": "short", "prompt": "设问", "referenceAnswer": "参考答案要点（1~3 句，必填）", "explanation": "评分要点：答到哪几点算对"}
]`

// 放在 JSON 样例之后：模型对「输出前核对」这类指令的遵守度明显高于散落在正文里的要求
export const QUESTION_FIELD_CHECKLIST = `输出前逐题核对，漏一个字段这道题就作废：
- single：必须有 options（4 个，纯文本，不带 "A." 之类前缀）和 answer（单个大写字母，且在 4 个选项范围内）
- judge：必须有 answer，值只能是「对」或「错」（不要写 true/false、不要写完整句子）
- short：必须有 referenceAnswer（非空），且写在 referenceAnswer 字段里，不要写进 answer
- 5 道题都要有 prompt 和 explanation`