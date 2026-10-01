// Default sanctions for the penalty roulette.
// Mostly things people genuinely hate doing (embarrassment, discomfort, losing
// small pleasures). The two money penalties are deliberately heavy (5,000 yen+)
// and add a social cost, because a plain fine alone is too easy to shrug off.
// weight: relative probability on the wheel. Each user can edit the list in the app.
window.DEFAULT_SANCTIONS = [
  {
    title: '苦手な人に1,000円を手渡し',
    detail:
      '自分が一番お金を渡したくない相手に、直接会って「ルーティンを守れなかったので」と言って1,000円を渡す。振込・送金アプリは不可。',
    color: '#e0213f',
    weight: 1,
  },
  {
    title: '1週間 毎朝冷水シャワー',
    detail: '明日から7日間、朝のシャワーは最初から最後まで水だけ。お湯に切り替えたらやり直し。',
    color: '#1d7ed6',
    weight: 1,
  },
  {
    title: '電話でサボり報告',
    detail:
      '親か親しい友人に電話をかけ、「今日ルーティンをサボりました」と自分の口で報告する。LINEやメッセージでの報告は不可。',
    color: '#ff7a18',
    weight: 1,
  },
  {
    title: 'ステータスメッセージ「三日坊主」',
    detail:
      'LINEのステータスメッセージ（またはSNSのプロフィール）を1週間「三日坊主です」に変更する。聞かれたら理由を正直に話す。',
    color: '#f2b705',
    weight: 1,
  },
  {
    title: '家中の水回り掃除',
    detail: 'トイレ・風呂・排水口・キッチンのシンクを、その日のうちに全部ピカピカにする。',
    color: '#2b9348',
    weight: 1,
  },
  {
    title: '翌朝4時半起き＋ゴミ拾い',
    detail: '翌朝4時30分に起き、近所の道で30分ゴミ拾いをする。拾ったゴミの写真を撮って残す。',
    color: '#6a4c93',
    weight: 1,
  },
  {
    title: '1週間 好物すべて禁止',
    detail: '7日間、お菓子・甘い飲み物・ジャンクフード・お酒をすべて断つ。',
    color: '#c9184a',
    weight: 1,
  },
  {
    title: '人前で反省文を読み上げ',
    detail:
      '家族・同僚・友人など3人以上の前で、なぜサボったのかを書いた反省文（200字以上）を声に出して読み上げる。',
    color: '#8338ec',
    weight: 1,
  },
  {
    title: '次の休日 丸1日スマホ断ち',
    detail: '次の休日は朝起きてから寝るまでスマホの電源を切って過ごす。',
    color: '#3a86ff',
    weight: 1,
  },
  {
    title: '罰金5,000円を友人に没収',
    detail:
      '信頼できる友人に5,000円を渡し「サボったので没収してください」と伝える。返金を求めてはいけない。',
    color: '#111827',
    weight: 1,
  },
];
