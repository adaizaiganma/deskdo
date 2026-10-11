import { diffDays } from "./dates";

/** 每日一言：內建的句子，每天換一句（不用連網） */
export interface Quote {
  text: string;
  source: string;
}

export const QUOTES: Quote[] = [
  { text: "千里之行，始於足下。", source: "老子《道德經》" },
  { text: "合抱之木，生於毫末；九層之臺，起於累土。", source: "老子《道德經》" },
  { text: "知人者智，自知者明。", source: "老子《道德經》" },
  { text: "學而時習之，不亦說乎？", source: "孔子《論語》" },
  { text: "知之為知之，不知為不知，是知也。", source: "孔子《論語》" },
  { text: "三人行，必有我師焉。", source: "孔子《論語》" },
  { text: "工欲善其事，必先利其器。", source: "孔子《論語》" },
  { text: "敏而好學，不恥下問。", source: "孔子《論語》" },
  { text: "溫故而知新，可以為師矣。", source: "孔子《論語》" },
  { text: "不積跬步，無以至千里；不積小流，無以成江海。", source: "荀子《勸學》" },
  { text: "鍥而不舍，金石可鏤。", source: "荀子《勸學》" },
  { text: "天行健，君子以自強不息。", source: "《周易》" },
  { text: "博學之，審問之，慎思之，明辨之，篤行之。", source: "《禮記・中庸》" },
  { text: "路漫漫其修遠兮，吾將上下而求索。", source: "屈原《離騷》" },
  { text: "業精於勤，荒於嬉；行成於思，毀於隨。", source: "韓愈《進學解》" },
  { text: "少壯不努力，老大徒傷悲。", source: "漢樂府《長歌行》" },
  { text: "盛年不重來，一日難再晨。及時當勉勵，歲月不待人。", source: "陶淵明《雜詩》" },
  { text: "長風破浪會有時，直掛雲帆濟滄海。", source: "李白《行路難》" },
  { text: "天生我材必有用。", source: "李白《將進酒》" },
  { text: "會當凌絕頂，一覽眾山小。", source: "杜甫《望嶽》" },
  { text: "欲窮千里目，更上一層樓。", source: "王之渙《登鸛雀樓》" },
  { text: "千淘萬漉雖辛苦，吹盡狂沙始到金。", source: "劉禹錫《浪淘沙》" },
  { text: "沉舟側畔千帆過，病樹前頭萬木春。", source: "劉禹錫《酬樂天揚州初逢席上見贈》" },
  { text: "山重水複疑無路，柳暗花明又一村。", source: "陸游《遊山西村》" },
  { text: "紙上得來終覺淺，絕知此事要躬行。", source: "陸游《冬夜讀書示子聿》" },
  { text: "莫等閒，白了少年頭，空悲切。", source: "岳飛《滿江紅》" },
  { text: "黑髮不知勤學早，白首方悔讀書遲。", source: "顏真卿《勸學》" },
  { text: "寶劍鋒從磨礪出，梅花香自苦寒來。", source: "《警世賢文》" },
  { text: "一年之計，莫如樹穀；十年之計，莫如樹木。", source: "《管子》" },
  { text: "不經一番寒徹骨，怎得梅花撲鼻香。", source: "黃檗禪師" },
];

/** 這一天的句子：同一天整天都一樣，隔天換下一句 */
export function quoteOf(day: string): Quote {
  const n = diffDays("2000-01-01", day);
  return QUOTES[((n % QUOTES.length) + QUOTES.length) % QUOTES.length];
}
