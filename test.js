const fs = require('fs');
const main = require('./index');

// eslint-disable-next-line no-undef
test('card gen', async () => {
  const bgmUserId = 'xiaoyvyv';

  const settings = {
    showAnimes: true,
    showCharacters: true,
    showGames: true,
    showMangas: true,
  };

  return main.generateBgmImage(bgmUserId, settings).then(async (string) => {
    console.log('测试卡片已生成');
    fs.writeFileSync('test.svg', string);
  });
}, 5 * 60 * 1000);
