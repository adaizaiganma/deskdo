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

/** 英文介面用的句子 */
export const QUOTES_EN: Quote[] = [
  { text: "The journey of a thousand miles begins with a single step.", source: "Laozi" },
  { text: "Well begun is half done.", source: "Aristotle" },
  { text: "We are what we repeatedly do.", source: "Will Durant, on Aristotle" },
  { text: "It does not matter how slowly you go as long as you do not stop.", source: "Confucius" },
  { text: "Real knowledge is to know the extent of one's ignorance.", source: "Confucius" },
  { text: "Lost time is never found again.", source: "Benjamin Franklin" },
  { text: "Well done is better than well said.", source: "Benjamin Franklin" },
  { text: "Energy and persistence conquer all things.", source: "Benjamin Franklin" },
  { text: "Nothing will work unless you do.", source: "Maya Angelou" },
  { text: "Simplicity is the ultimate sophistication.", source: "Leonardo da Vinci" },
  { text: "Patience is bitter, but its fruit is sweet.", source: "Jean-Jacques Rousseau" },
  { text: "He who has a why to live can bear almost any how.", source: "Friedrich Nietzsche" },
  { text: "The secret of getting ahead is getting started.", source: "Mark Twain" },
  { text: "Continuous effort is the key to unlocking our potential.", source: "Winston Churchill" },
  { text: "Do what you can, with what you have, where you are.", source: "Theodore Roosevelt" },
  { text: "Little by little, one travels far.", source: "J. R. R. Tolkien" },
  { text: "All we have to decide is what to do with the time that is given us.", source: "J. R. R. Tolkien" },
  { text: "Rome was not built in a day.", source: "Proverb" },
  { text: "Slow and steady wins the race.", source: "Aesop" },
  { text: "Genius is one percent inspiration and ninety-nine percent perspiration.", source: "Thomas Edison" },
  { text: "The best way out is always through.", source: "Robert Frost" },
  { text: "What we think, we become.", source: "The Buddha" },
  { text: "Knowing is not enough; we must apply.", source: "Johann Wolfgang von Goethe" },
  { text: "Whatever you can do, or dream you can, begin it.", source: "Johann Wolfgang von Goethe" },
  { text: "Be not afraid of going slowly; be afraid only of standing still.", source: "Chinese proverb" },
  { text: "First say to yourself what you would be; and then do what you have to do.", source: "Epictetus" },
  { text: "You have power over your mind, not outside events.", source: "Marcus Aurelius" },
  { text: "Waste no more time arguing what a good man should be. Be one.", source: "Marcus Aurelius" },
  { text: "It is not that we have a short time to live, but that we waste a lot of it.", source: "Seneca" },
  { text: "Luck is what happens when preparation meets opportunity.", source: "Seneca" },
];

/** 這一天的句子：同一天整天都一樣，隔天換下一句 */
export function quoteOf(day: string, list: Quote[] = QUOTES): Quote {
  const n = diffDays("2000-01-01", day);
  return list[((n % list.length) + list.length) % list.length];
}
