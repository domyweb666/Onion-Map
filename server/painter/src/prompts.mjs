// 畫圖的提示詞。手機不送提示詞，只送 kind 和 style，內容都在這裡。
// 這份是正本，server/painter/src/prompts.mjs 是同一份的複本（npm test 會比對兩份有沒有一樣）。
// 改完在這個資料夾跑：cp prompts.mjs ../../server/painter/src/prompts.mjs

const PENCIL = `手繪色鉛筆風格：米白色紙，黑色細墨線勾邊，色鉛筆上色，筆觸看得見。
街區淡褐色，裡面用細線分成一塊一塊的房子。主要道路淡黃色與淡橘色，巷弄細線。公園和綠地畫成一叢叢綠色的樹，河和水藍色。`;

const FRAME = `取景照原圖：不要放大、不要縮小、不要裁切、不要轉角度，原圖貼著邊的東西畫完也要貼在同一個位置。`;

const NO_EXTRA = `不要畫任何路線或箭頭，不要畫任何文字、數字、符號、圖示。原圖上如果有字或小圖示，當作沒看到，用旁邊的顏色補過去。`;

const PROMPTS = {
  // 一天一張的地圖
  'day/pencil': `把這張地圖重畫成${PENCIL}
所有街道、街區、公園、河流的位置和形狀完全照原圖，不要新增、不要移動、不要省略。
${FRAME}
${NO_EXTRA}
不要畫邊框。直式 2:3，1024×1536，畫滿整張。`,

  // 走過的一帶，範圍比較大的底圖
  'base/pencil': `把這張範圍比較大的地圖重畫成${PENCIL}
海岸線、河岸、湖岸的形狀和位置一定要跟原圖一樣，水的藍色要一眼看得出來。
主要幹道的走向、彎的地方、交會的地方照原圖。小巷可以畫得疏一點，山和大片綠地畫成一叢叢的樹。
${FRAME}
${NO_EXTRA}
整張畫滿到四個邊，不要邊框，不要留白，不要紙邊，不要捲起來的紙角，不要陰影。直式 2:3，1024×1536。`,
};

export const KINDS = ['day', 'base'];
export const STYLES = ['pencil'];

// 沒有這種組合就回空字串
export function promptFor(kind, style) {
  const key = `${kind}/${style}`;
  return Object.hasOwn(PROMPTS, key) ? PROMPTS[key] : '';
}
