const core = require('@actions/core');
const github = require('@actions/github');
const ejs = require('ejs');
const bgm = require('./api/bgm');

function getName(subject) {
  if (subject == null) return '';
  const cn = subject.name_cn || '';
  if (cn.length > 0) return cn;
  return subject.name || '';
}

function getTags(item) {
  const tags = item.tags || [];
  if (tags.length !== 0) return tags.join(', ');
  const subject = item.subject || {};
  const t = (subject.tags || []).map((tag) => tag.name).join(', '); // Rename 'item' to 'tag'
  return t.length === 0 ? '暂无' : t;
}

async function generateSubjectItem(items, tmpl, typeName) {
  if (items == null) return '';
  const renderedItems = await Promise.all(items.map(async (item) => {
    const image = await bgm.downloadImage(item.subject.images.small);
    return ejs.renderFile(tmpl, {
      item,
      typeName,
      getName,
      getTags,
      image,
    });
  }));
  return renderedItems.join('');
}

async function uploadImage(githubToken, string) {
  // const {owner, repo} = {owner: "xiaoyvyv", repo: "bangumi-data"};
  const { owner, repo } = github.context.repo;
  const fileName = core.getInput('bgm-img-path') || 'data/bgm-collection.svg';

  console.log(`owner:${owner}, repo: ${repo}`);

  const octokit = github.getOctokit(githubToken);
  const res = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: fileName,
  }).catch(() => ({ data: {} }));
  const sha = res.data.sha || '';

  octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: fileName,
    message: 'Generate Bangumi Card',
    content: Buffer.from(string).toString('base64'),
    committer: {
      name: 'GitHub Actions',
      email: 'actions@github.com',
    },
    author: {
      name: 'GitHub Actions',
      email: 'actions@github.com',
    },
    sha,
  }).then(() => {
    console.log('上传成功');
    core.setOutput('message', `https://github.com/${owner}/${repo}/raw/main/${fileName}`);
  }).catch((error) => {
    console.error(`Error uploading file "${fileName}":`, error);
    core.setOutput('message', `Error uploading file "${fileName}":${error}`);
    core.setFailed(error.message);
  });
}

async function generateBgmImage(userId) {
  const totalTags = new Set();
  const animeList = [];
  const bookList = [];
  const gameList = [];

  const data = await bgm.loadAllUserCollection(userId);

  let characters = await bgm.loadCharacter(userId);

  data.forEach((item) => {
    // TAG
    const tags = item.tags || [];
    tags.forEach((tag) => totalTags.add(tag));

    if (item.subject_type === 1) {
      bookList.push(item);
    }
    if (item.subject_type === 2) {
      animeList.push(item);
    }
    if (item.subject_type === 4) {
      gameList.push(item);
    }
  });

  // 按评分，收藏时间排序
  animeList.sort((a, b) => (b.rate === a.rate ? b.updated_at > a.updated_at : b.rate - a.rate));
  bookList.sort((a, b) => (b.rate === a.rate ? b.updated_at > a.updated_at : b.rate - a.rate));

  // 最喜欢的动画
  const topAnime = animeList.length >= 3 ? animeList.slice(0, 3) : animeList;
  const tmpAnime = await generateSubjectItem(topAnime, 'tmpl/subject.ejs', '动画');

  // 最喜欢玩的游戏
  gameList.sort((a, b) => b.rate - a.rate);
  const topGame = gameList.length >= 1 ? gameList.slice(0, 1) : gameList;
  const mostLikeGame = await generateSubjectItem(topGame, 'tmpl/subject.ejs', '游戏');

  // 最近玩的的游戏
  const recently = gameList.filter((item) => item.type === 3);
  recently.sort((a, b) => (b.updated_at > a.updated_at ? 1 : 0));
  const recentGame = recently.length >= 1 ? recently.slice(0, 1) : recently;
  const recentlyGame = await generateSubjectItem(recentGame, 'tmpl/subject.ejs', '游戏');

  // 常用标签
  let topTags = [...totalTags];
  topTags = topTags.length >= 3 ? topTags.slice(0, 3) : topTags;

  // 最喜欢的人物
  let characterHtml = '';
  characters = characters.length >= 22 ? characters.slice(0, 22) : characters;
  characterHtml = await Promise.all(characters.map(async (character) => {
    const imgUrl = character.image;
    const imgData = await bgm.downloadImage(imgUrl);
    return `<img src="data:image/png;base64,${imgData}" width="36" height="54" alt=""/>`;
  }));
  characterHtml = characterHtml.join('');

  // 玩过，在玩，点评的游戏
  let doneGame = 0;
  gameList.forEach((item) => {
    if (item.type === 2) {
      doneGame += 1;
    }
  });

  return ejs.renderFile('tmpl/tmpl.ejs', {
    topTags,
    animeList,
    bookList,
    tmpAnime,
    characterHtml,
    userId,
    doneGame,
    mostLikeGame,
    recentlyGame,
  });
}

module.exports = {
  generateBgmImage,
};

async function main() {
  try {
    let bgmUserId = core.getInput('bgm-user-id').trim();
    if (bgmUserId.length === 0) {
      bgmUserId = 'xiaoyvyv';
    }

    const githubToken = core.getInput('github-token');

    console.log(`Generate for ${bgmUserId}!, token: ${githubToken}`);

    await generateBgmImage(bgmUserId).then(async (string) => {
      console.log('生成卡片执行完成');
      await uploadImage(githubToken, string);
    });
  } catch (error) {
    core.setFailed(error.message);
  }
}

if (require.main === module) {
  main();
}
