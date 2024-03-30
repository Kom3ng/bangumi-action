const core = require('@actions/core');
const github = require('@actions/github');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const bgm = require('./api/bgm');

const template = fs.readFileSync(path.join(__dirname, 'tmpl/tmpl.ejs'), 'utf8');

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

async function generateSubjectItem(items, typeName) {
  if (items == null) return [];

  await Promise.all(items.map(async (i) => {
    const image = await bgm.downloadImage(i.subject.images.small);
    // eslint-disable-next-line no-param-reassign
    i.typeName = typeName;
    // eslint-disable-next-line no-param-reassign
    i.image = image;
    return i;
  }));

  return items;
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

async function generateBgmImage(userId, settings) {
  const totalTags = new Map();
  const animeList = [];
  const bookList = [];
  const gameList = [];

  const data = await bgm.loadAllUserCollection(userId);

  let characters = settings.showCharacters ? await bgm.loadCharacter(userId) : [];

  data.forEach((item) => {
    // TAG
    const tags = item.tags || [];
    tags.forEach((tag) => {
      if (totalTags.has(tag)) {
        totalTags.set(tag, totalTags.get(tag) + 1);
      } else {
        totalTags.set(tag, 1);
      }
    });

    if (item.subject_type === 1 && settings.showMangas) {
      bookList.push(item);
    }
    if (item.subject_type === 2 && settings.showAnimes) {
      animeList.push(item);
    }
    if (item.subject_type === 4 && settings.showGames) {
      gameList.push(item);
    }
  });

  // 按评分，收藏时间排序
  animeList.sort((a, b) => (b.rate === a.rate ? b.updated_at > a.updated_at : b.rate - a.rate));
  bookList.sort((a, b) => (b.rate === a.rate ? b.updated_at > a.updated_at : b.rate - a.rate));

  // 最喜欢的动画
  const animes = animeList.length >= 3 ? animeList.slice(0, 3) : animeList;
  const topAnime = await generateSubjectItem(animes, '动画');

  // 最喜欢的书籍
  const books = bookList.length >= 3 ? bookList.slice(0, 3) : bookList;
  const favoriteBooks = await generateSubjectItem(books, '书籍');

  // 最喜欢玩的游戏
  gameList.sort((a, b) => b.rate - a.rate);
  const topGame = gameList.length >= 1 ? gameList.slice(0, 1) : gameList;
  const favoriteGames = await generateSubjectItem(topGame, '游戏');

  // 最近玩的的游戏
  const recently = gameList.filter((item) => item.type === 3);
  recently.sort((a, b) => (b.updated_at > a.updated_at ? 1 : 0));
  const recentGame = recently.length >= 1 ? recently.slice(0, 1) : recently;
  const recentlyGames = await generateSubjectItem(recentGame, '游戏');

  // 常用标签
  let topTags = Array.from(totalTags).sort((a, b) => b[1] - a[1]).map((tag) => tag[0]);
  topTags = topTags.length >= 3 ? topTags.slice(0, 3) : topTags;

  // 最喜欢的人物
  characters = characters.length >= 22 ? characters.slice(0, 22) : characters;
  characters = await Promise.all(characters.map(async (character) => {
    const imgUrl = character.image;
    const imgData = await bgm.downloadImage(imgUrl);
    return { image: imgData };
  }));

  // 玩过，在玩，点评的游戏
  let doneGame = 0;
  gameList.forEach((item) => {
    if (item.type === 2) {
      doneGame += 1;
    }
  });

  return ejs.render(template, {
    getTags,
    getName,
    topTags,
    animeList,
    bookList,
    characters,
    userId,
    doneGame,
    favoriteGames,
    recentlyGames,
    animes: topAnime,
    settings,
    favoriteBooks,
  });
}

module.exports = {
  generateBgmImage,
};

if (require.main === module) {
  try {
    let bgmUserId = core.getInput('bgm-user-id').trim();
    if (bgmUserId.length === 0) {
      bgmUserId = 'xiaoyvyv';
    }

    const githubToken = core.getInput('github-token');

    const settings = {};

    settings.showAnimes = core.getBooleanInput('show-animes');
    settings.showCharacters = core.getBooleanInput('show-characters');
    settings.showGames = core.getBooleanInput('show-games');
    settings.showMangas = core.getBooleanInput('show-mangas');

    console.log(`Generate for ${bgmUserId}!`);

    generateBgmImage(bgmUserId, settings).then(async (string) => {
      console.log('生成卡片执行完成');
      await uploadImage(githubToken, string);
    });
  } catch (error) {
    core.setFailed(error.message);
  }
}
