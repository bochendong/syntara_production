import type { NativeClassStanding } from '../../data/platform-api-contracts';

export type StandingArtState = 'start' | 'practice' | 'progress' | 'leader';

export type StandingIllustration = {
  id: string;
  quote: string;
  attribution: string;
  source: string;
  alt: string;
  states: readonly StandingArtState[];
};

/** 用户选定的 40 幅独立手绘。外文引用据所列原文自译，非指定出版译本。 */
export const CLASS_STANDING_ILLUSTRATIONS: readonly StandingIllustration[] = [
  {
    id: '01-time',
    quote: '并不是我们拥有的时间太少，而是浪费掉的太多。',
    attribution: '塞涅卡《论生命之短暂》',
    source: 'https://vreeman.com/seneca/on-the-shortness-of-life',
    states: ['start', 'practice'],
    alt: '学生放下手机，望向窗外渐渐消逝的夕阳',
  },
  {
    id: '02-create',
    quote: '我不能创造的，我就不理解。',
    attribution: '理查德·费曼 · 黑板题句',
    source: 'https://magazine.caltech.edu/post/biology-through-the-eyes-of-a-physicist',
    states: ['practice', 'progress'],
    alt: '戴眼镜的女生亲手调试自己组装的小车',
  },
  {
    id: '03-honesty',
    quote: '首先，不要对自己撒谎。',
    attribution: '陀思妥耶夫斯基《卡拉马佐夫兄弟》',
    source: 'https://www.gutenberg.org/files/28054/28054-h/28054-h.htm',
    states: ['practice'],
    alt: '学生洗脸时停下来，认真看着镜子里的自己',
  },
  {
    id: '04-kindness',
    quote: '我们活着，难道不是为了让彼此的生活少一些艰难吗？',
    attribution: '乔治·艾略特《米德尔马契》',
    source: 'https://www.gutenberg.org/files/145/145-h/145-h.htm',
    states: ['progress', 'leader'],
    alt: '两位同学平等地讨论编程问题',
  },
  {
    id: '05-choice',
    quote: '更能显示我们真正是谁的，是我们的选择，而非我们的能力。',
    attribution: 'J. K. 罗琳《哈利·波特与密室》',
    source: 'https://www.harrypotter.com/features/unpopular-opinions-only-character-decisions',
    states: ['start', 'practice', 'progress'],
    alt: '女生将手机倒扣，打开自己的笔记本',
  },
  {
    id: '06-solitude',
    quote: '我越是孤独、无友、无人支持，就越要尊重自己。',
    attribution: '夏洛蒂·勃朗特《简·爱》',
    source: 'https://www.gutenberg.org/files/1260/1260-h/1260-h.htm',
    states: ['start', 'practice'],
    alt: '独居的学生为自己准备一顿热饭',
  },
  {
    id: '07-days',
    quote: '你聪明的，告诉我，我们的日子为什么一去不复返呢？',
    attribution: '朱自清《匆匆》',
    source: 'https://zh.wikisource.org/zh-hans/匆匆',
    states: ['start', 'practice'],
    alt: '女生在雨中的电车站留意随风飘过的落叶',
  },
  {
    id: '08-wild-life',
    quote: '告诉我，你打算怎样度过这唯一、狂野而珍贵的一生？',
    attribution: '玛丽·奥利弗《夏日》',
    source: 'https://poets.org/poem/summer-day',
    states: ['start', 'practice', 'progress'],
    alt: '背着背包的学生望向开阔的湖面',
  },
  {
    id: '09-turning-point',
    quote: '人生的道路虽然漫长，但紧要处常常只有几步。',
    attribution: '柳青 · 路遥《人生》题引',
    source: 'https://paper.people.com.cn/hqrw/html/2015-05/06/content_1631005.htm',
    states: ['start', 'progress'],
    alt: '新生跨进工程社团的门口',
  },
  {
    id: '10-given-time',
    quote: '我们必须决定的，是如何使用被给予的时间。',
    attribution: 'J. R. R. 托尔金《魔戒：护戒同盟》',
    source:
      'https://www.tolkiengesellschaft.de/49252/space-and-time-in-tolkiens-work-tolkien-seminar-2022/',
    states: ['start', 'practice'],
    alt: '学生在课间的公园长椅上读书',
  },
  {
    id: '11-life-cost',
    quote: '一件东西的代价，是你为它交换出去的生命。',
    attribution: '亨利·戴维·梭罗《瓦尔登湖》',
    source: 'https://www.gutenberg.org/files/205/205-h/205-h.htm',
    states: ['practice'],
    alt: '学生站在商店橱窗前，思考自己的选择',
  },
  {
    id: '12-time-wastes-me',
    quote: '我荒废了时间，如今时间也在荒废我。',
    attribution: '威廉·莎士比亚《理查二世》',
    source: 'https://catalog.folger.edu/record/256115',
    states: ['practice'],
    alt: '学生放下游戏手柄，拉开窗帘看见天色已晚',
  },
  {
    id: '13-live-not-dream',
    quote: '沉溺于幻想而忘记生活，是不行的。',
    attribution: 'J. K. 罗琳《哈利·波特与魔法石》',
    source:
      'https://www.harrypotter.com/features/important-pieces-of-dialogue-from-philosophers-stone',
    states: ['start', 'practice'],
    alt: '女生从墙上取下吉他，准备亲手练习',
  },
  {
    id: '14-diligence',
    quote: '业精于勤，荒于嬉；行成于思，毁于随。',
    attribution: '韩愈《进学解》',
    source: 'https://zh.wikisource.org/zh-hans/進學解',
    states: ['practice', 'progress'],
    alt: '学生专注地练习焊接电路板',
  },
  {
    id: '15-knowing-doing',
    quote: '知而不行，只是未知。',
    attribution: '王阳明《传习录》',
    source: 'https://zh.wikisource.org/zh-hans/王陽明集/卷01',
    states: ['start', 'practice'],
    alt: '女生动手调整自行车的刹车',
  },
  {
    id: '16-become-brave',
    quote: '通过勇敢的行动，我们成为勇敢的人。',
    attribution: '亚里士多德《尼各马可伦理学》',
    source:
      'https://pressbooks.library.torontomu.ca/nicomacheanethics/chapter/1-moral-virtue-is-acquired-by-the-repetition-of-the-corresponding-acts/',
    states: ['start', 'progress'],
    alt: '学生鼓起勇气在课堂上举手提问',
  },
  {
    id: '17-perseverance',
    quote: '伟大的事业靠的不是力量，而是坚持。',
    attribution: '塞缪尔·约翰逊《拉塞拉斯》',
    source: 'https://www.gutenberg.org/files/652/652-h/652-h.htm',
    states: ['practice', 'progress'],
    alt: '学生根据前几次尝试重新搭建桥梁模型',
  },
  {
    id: '18-study-purpose',
    quote: '非学无以广才，非志无以成学。',
    attribution: '诸葛亮《诫子书》',
    source: 'https://zh.wikisource.org/zh-hant/誡子書',
    states: ['start', 'practice'],
    alt: '女生从书架上选择一本入门教材',
  },
  {
    id: '19-persist',
    quote: '锲而不舍，金石可镂。',
    attribution: '荀子《劝学》',
    source: 'https://scjg.hebei.gov.cn/info/5599',
    states: ['practice', 'progress'],
    alt: '学生在攀岩墙上再次尝试一个动作',
  },
  {
    id: '20-learning-limits',
    quote: '学然后知不足，教然后知困。',
    attribution: '《礼记·学记》',
    source: 'https://zh.wikisource.org/zh-hant/禮記/學記',
    states: ['practice', 'leader'],
    alt: '女生向同学讲解时，发现并修改自己的推导',
  },
  {
    id: '21-no-self-deception',
    quote: '不要欺骗自己，而你恰恰是最容易被自己欺骗的人。',
    attribution: '理查德·费曼《草包族科学》',
    source: 'https://calteches.library.caltech.edu/51/02/CargoCult.htm',
    states: ['practice'],
    alt: '学生用卡尺重新核对自己制作的零件',
  },
  {
    id: '22-face-it',
    quote: '必须敢于正视，这才可望敢想，敢说，敢作，敢当。',
    attribution: '鲁迅《论睁了眼看》',
    source: 'https://zh.wikisource.org/zh-hant/論睜了眼看',
    states: ['practice'],
    alt: '女生仔细观察失败的打印件，寻找原因',
  },
  {
    id: '23-control',
    quote: '有些事情在我们的掌控之中，另一些则不在。',
    attribution: '爱比克泰德《手册》',
    source: 'https://classics.mit.edu/Epictetus/epicench.html',
    states: ['start', 'practice'],
    alt: '学生在雨中的车站整理好背包和外套',
  },
  {
    id: '24-responsible',
    quote: '你要永远对你所驯养的负责。',
    attribution: '圣埃克苏佩里《小王子》',
    source: 'https://www.blog.lepetitprince.com/oeuvre/thematique/',
    states: ['start', 'practice'],
    alt: '学生为自己照顾的猫换上一碗清水',
  },
  {
    id: '25-learn-from-past',
    quote: '过去会令人受伤。但你可以逃避它，也可以向它学习。',
    attribution: '电影《狮子王》· 拉飞奇',
    source: 'https://news.disney.com/the-most-important-quotes-from-the-lion-king-according-to-you',
    states: ['practice', 'progress'],
    alt: '学生调整滑板护具，准备吸取上一次的经验',
  },
  {
    id: '26-ability-responsibility',
    quote: '能力越大，责任越大。',
    attribution: '《蜘蛛侠》系列',
    source: 'https://www.marvel.com/characters/spider-man-peter-parker/in-comics',
    states: ['progress', 'leader'],
    alt: '女生先断开电源，再和同学一起检查设备',
  },
  {
    id: '27-be-good',
    quote: '别再争论好人应该是什么样。去成为那样的人。',
    attribution: '马可·奥勒留《沉思录》',
    source: 'https://www.gutenberg.org/files/2680/2680-h/2680-h.htm',
    states: ['practice', 'leader'],
    alt: '学生默默捡起教室里散落的公共资料',
  },
  {
    id: '28-advantages',
    quote: '世上的人，并非都曾拥有你那些有利条件。',
    attribution: 'F. S. 菲茨杰拉德《了不起的盖茨比》',
    source: 'https://www.gutenberg.org/files/64317/64317-h/64317-h.htm',
    states: ['leader'],
    alt: '学生为刚结束咖啡店工作的同学留出学习的位置',
  },
  {
    id: '29-ignorance-confidence',
    quote: '无知比知识更容易使人产生自信。',
    attribution: '查尔斯·达尔文《人类的由来》',
    source: 'https://www.gutenberg.org/files/2300/2300-h/2300-h.htm',
    states: ['leader'],
    alt: '学生看见机械模型的复杂结构，意识到还有很多要学',
  },
  {
    id: '30-other-argument',
    quote: '只了解自己这一方论据的人，对这一方也了解得很少。',
    attribution: '约翰·斯图尔特·密尔《论自由》',
    source: 'https://www.gutenberg.org/files/34901/34901-h/34901-h.htm',
    states: ['practice', 'leader'],
    alt: '同学们认真倾听彼此不同的解释',
  },
  {
    id: '31-highest-throne',
    quote: '即使坐上世上最高的宝座，我们也仍是用自己的屁股坐着。',
    attribution: '米歇尔·德·蒙田《随笔集·论经验》',
    source: 'https://www.gutenberg.org/files/3600/3600-h/3600-h.htm',
    states: ['leader'],
    alt: '戴着纸皇冠的普通学生坐在华丽扶手椅上',
  },
  {
    id: '32-dont-know',
    quote: '我不知道，也不以为自己知道。',
    attribution: '柏拉图《申辩篇》· 苏格拉底',
    source: 'https://www.gutenberg.org/files/1656/1656-h/1656-h.htm',
    states: ['practice', 'leader'],
    alt: '女生坦诚地向同学提出自己还不理解的问题',
  },
  {
    id: '33-wise-fool',
    quote: '愚人自以为聪明，智者却知道自己的愚蠢。',
    attribution: '威廉·莎士比亚《皆大欢喜》',
    source: 'https://www.folger.edu/blogs/shakespeare-and-beyond/shakespeare-quotes-about-fools/',
    states: ['leader'],
    alt: '学生望向广阔的书架，对自己的所知保持谦逊',
  },
  {
    id: '34-everyone-teacher',
    quote: '三人行，必有我师焉。',
    attribution: '《论语·述而》',
    source: 'https://www.shidianguji.com/zh/mingju/7621658420341620763',
    states: ['practice', 'progress', 'leader'],
    alt: '三位同学互相交流摄影技巧',
  },
  {
    id: '35-own-understanding',
    quote: '要有勇气运用你自己的理解力。',
    attribution: '伊曼努尔·康德《什么是启蒙？》',
    source: 'https://gchshistorydocs.weebly.com/uploads/1/0/3/4/10349046/immanuel_kant.pdf',
    states: ['start', 'practice'],
    alt: '女生摘下讲解耳机，亲自观察机械装置',
  },
  {
    id: '36-self-mastery',
    quote: '胜人者有力，自胜者强。',
    attribution: '《道德经》第三十三章',
    source: 'https://daodejing.org/33.html',
    states: ['progress', 'leader'],
    alt: '女生在清晨系好跑鞋，准备开始自己的锻炼',
  },
  {
    id: '37-different-dream',
    quote: '我的梦想与你不同，并不意味着它们不重要。',
    attribution: '电影《小妇人》（2019）· 梅格',
    source: 'https://thesuccessfulscreenwriter.com/wp-content/uploads/little-women-2019.pdf',
    states: ['start', 'practice', 'progress'],
    alt: '女生认真制作一只属于自己的陶碗',
  },
  {
    id: '38-think-yourself',
    quote: '读书时，不要只想作者在想什么，也要想想你自己在想什么。',
    attribution: '电影《死亡诗社》· 基廷',
    source:
      'https://www.sellingyourscreenplay.com/wp-content/uploads/screenplay/scripts/Dead-Poets-Society-%281%29.pdf',
    states: ['practice', 'leader'],
    alt: '学生暂停阅读，思考自己对书中内容的理解',
  },
  {
    id: '39-anywhere',
    quote: '并非人人都能成为伟大的艺术家，但伟大的艺术家可能来自任何地方。',
    attribution: '电影《美食总动员》· 安东·伊戈',
    source:
      'https://indac.org/blog/anton-ego-tastes-ratatouille-script-to-screen-by-disney%E2%80%A2pixar/',
    states: ['start', 'progress'],
    alt: '学生在普通的合租厨房里认真做好一道菜',
  },
  {
    id: '40-lived-wisdom',
    quote: '知识可以传授，智慧却不能。',
    attribution: '赫尔曼·黑塞《悉达多》',
    source: 'https://www.gutenberg.org/files/2500/2500-h/2500-h.htm',
    states: ['practice', 'leader'],
    alt: '学生合上书，观察溪水经过石头时的流动',
  },
];

export function standingArtState(
  standing: NativeClassStanding,
  hasProgress: boolean,
): StandingArtState {
  if (standing.metrics.solved.me === 0) return 'start';
  // 做对更多题，即使名次没变，也应先肯定这次实际进步。
  if (hasProgress) return 'progress';
  if (standing.rank <= Math.max(1, Math.ceil(standing.size / 5))) return 'leader';
  return 'practice';
}

/** 同一门课、时间范围、学习状态在同一自然日保持稳定，重新渲染不换图。 */
export function selectStandingIllustration(
  standing: NativeClassStanding,
  hasProgress: boolean,
  date = new Date(),
): StandingIllustration {
  const state = standingArtState(standing, hasProgress);
  const pool = CLASS_STANDING_ILLUSTRATIONS.filter((item) => item.states.includes(state));
  const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const seed = `${standing.courseId}:${standing.period}:${state}:${day}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  return pool[(hash >>> 0) % pool.length];
}
