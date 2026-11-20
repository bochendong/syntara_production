export const WEAPONS = {
  sweep:    { name: '尺子挥砍',   tag: 'melee',  c: '#e0473c', ch: '砍', ups: ['lv'],       desc: '朝最近的怪挥出一大片扇形', evo: { relic: 'dumbbell', name: '旋风斩', desc: '变成原地抡整圈，每 0.3 秒转一圈，范围 ×1.5，还会把怪往里吸' } },
  spin:     { name: '尺子回旋',   tag: 'melee',  c: '#f08a24', ch: '旋', ups: ['lv'],          nText: '多一把尺子绕着转', desc: '几把尺子一直绕着你转，不用瞄准，贴身持续伤害', evo: { relic: 'wrist', name: '尺阵', desc: '尺子翻倍，转得更大更快' } },
  mop:      { name: '拖把',       tag: 'melee',  c: '#4aa8c8', ch: '拖', ups: ['lv'],       funny: 1, desc: '朝前一拖一大片，地上留下水渍，踩进去的怪减速并持续掉血。擦地任务擦得飞快', evo: { relic: 'bucket', name: '洪水拖把', desc: '水渍变成大水洼，范围更大，伤害 2.5 倍' } },
  pencil:   { name: '铅笔飞镖',   tag: 'ranged', c: '#3f97e8', ch: '铅', ups: ['lv'], nText: '每次多射一支', desc: '射出会穿透的铅笔，一条直线清一排', evo: { relic: 'scratch', name: '铅笔暴雨', desc: '每次出手额外向四周射出 10 支铅笔' } },
  plane:    { name: '纸飞机',     tag: 'ranged', c: '#38b2c9', ch: '纸', ups: ['lv'],          nText: '每次多一架', desc: '会自己拐弯追怪，边跑边打最省心', evo: { relic: 'scope', name: '纸鹤群', desc: '数量 +3，命中不消失，能连穿 4 只' } },
  slipper:  { name: '妈妈的拖鞋', tag: 'ranged', c: '#ff7a5a', ch: '鞋', ups: ['lv'],          nText: '每次多扔一只', funny: 1, desc: '扔出去还会飞回来，来回各打一次', evo: { relic: 'mom', name: '拖鞋连环', desc: '拖鞋飞到头时再分出两只' } },
  stapler:  { name: '订书机枪',   tag: 'gun',    c: '#7a8394', ch: '钉', ups: ['lv'],          nText: '并排多射一发', desc: '高速连发，擅长持续单体输出', evo: { relic: 'dual', name: '钉枪风暴', desc: '再加四道旋转弹流，扫遍全场' } },
  shotgun:  { name: '橡皮霰弹',   tag: 'gun',    c: '#e05a8a', ch: '霰', ups: ['lv'],          nText: '一次多喷两块', desc: '贴脸喷一扇橡皮块，近身爆发高', evo: { relic: 'reddot', name: '橡皮加农', desc: '每颗橡皮命中都会爆炸' } },
  bolt:     { name: '荧光闪电',   tag: 'magic',  c: '#a46bff', ch: '电', ups: ['lv'],          nText: '多跳 2 次', desc: '闪电在怪之间来回跳，专打扎堆的', evo: { relic: 'ink', name: '荧光雷暴', desc: '跳 14 次，每一跳还会电到旁边的怪' } },
  coffee:   { name: '咖啡旋风',   tag: 'magic',  c: '#8a5a2b', ch: '咖', ups: ['lv'],       desc: '自动朝最近的怪扔一杯咖啡，落地变成旋风，持续伤害并减速', evo: { relic: 'caffeine', name: '咖啡龙卷', desc: '冷却减半，旋风更大更久，还会把怪往中心吸' } },
  sock:     { name: '臭袜子',     tag: 'magic',  c: '#8ab84a', ch: '袜', ups: ['lv'],       funny: 1, desc: '身边一直飘着一圈臭气，怪进来就掉血还变慢', evo: { relic: 'laundry', name: '生化危机', desc: '臭气范围 ×1.6，熏到的怪受到的所有伤害 +25%' } },
  rollcall: { name: '点名册',     tag: 'magic',  c: '#c84a4a', ch: '点', ups: ['lv'],          nText: '每次多点一个', funny: 1, desc: '专挑血最厚的怪点名，一本书砸下去。打精英和大魔王伤害翻倍', evo: { relic: 'redpen', name: '全班点名', desc: '一次点 5 个，书落地还有冲击波' } },
  minion:   { name: '便利贴小人', tag: 'summon', c: '#f0a623', ch: '贴', ups: ['lv'],     nText: '每次多召一个', desc: '召唤冲上去打架的小人，到时间就散掉', evo: { relic: 'poster', name: '便利贴军团', desc: '每次召唤数量翻倍，小人击杀时再分裂出一个' } },
  lamp:     { name: '台灯炮台',   tag: 'summon', c: '#d4a000', ch: '灯', ups: ['lv'],     nText: '每次多放一盏', desc: '放下会自动射光束的台灯，原地守点', evo: { relic: 'banner', name: '探照灯', desc: '光束变成一整条，直线上的怪全中' } },
  duck:     { name: '橡皮鸭',     tag: 'summon', c: '#ffd23f', ch: '鸭', ups: ['lv'],     nText: '每次多放一只', funny: 1, desc: '嘎嘎叫，把附近的怪全引过去，时间到了炸成彩带', evo: { relic: 'bath', name: '鸭鸭大军', desc: '每次放 3 倍数量，爆炸范围翻倍' } },
};

export const ALT = {
  sweep:   { name: '地裂斩',     desc: '每次挥砍顺着方向劈出一道地裂，前方 9 米直线上的怪都挨一下' },
  pencil:  { name: '自动铅笔',   desc: '出手快一倍，每支铅笔多穿透 3 只' },
  stapler: { name: '订书钉狙击', desc: '改成一次射一枚巨型钉，伤害很高，一路穿到底' },
  shotgun: { name: '橡皮花洒',   desc: '改成朝四面八方喷一整圈橡皮' },
  bolt:    { name: '雷劈',       desc: '改成从天上劈下 6 道雷，每道落地炸开一小圈' },
  coffee:  { name: '三杯连饮',   desc: '一次扔 3 杯，分给 3 个不同的怪' },
  sock:    { name: '臭气加倍',   desc: '身边多出一层臭气圈。圈内怪物减速 75%，离开后仍减速 1 秒。圈内其他队友每秒回复 4 点生命' },
};

export const BOSSES = {
  boss:   { name: '期末大魔王', atk: ['stamp', 'rush', 'slash', 'slam', 'missiles', 'summon'], wide: 'papers', minions: ['cross', 'phone'] },
  dean:   { name: '教导主任',   atk: ['shout', 'pull', 'lane', 'missiles', 'slam', 'summon'], wide: 'shout3', minions: ['chalk', 'cross'] },
  coach:  { name: '体育老师',   atk: ['throw', 'whistle', 'rush', 'ticks', 'summon', 'slam'], wide: 'ballrain', minions: ['clock', 'bat'] },
  kraken: { name: '墨水巨怪',   atk: ['inkrain', 'tent', 'leap', 'spiral', 'summon', 'slam'], wide: 'flood', minions: ['ink', 'ink'] },
};
