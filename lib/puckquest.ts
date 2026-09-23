export type QuestTheme={id:string;name:string;short:string;division:'Atlantic'|'Metropolitan'|'Central'|'Pacific';conference:'Eastern'|'Western';image:string};
export type QuestHistory={at:string;event:'registered'|'transfer'|'trade'|'listed'|'unlisted';from?:string;to?:string;note:string};
export type QuestCollectible={id:string;themeId:string;serial:string;ownerEmail:string;registeredAt:string;status:'owned'|'listed';history:QuestHistory[]};
export type QuestCode={code:string;themeId:string;status:'ready'|'redeemed'|'void';createdAt:string;redeemedAt?:string;redeemedBy?:string;collectibleId?:string};
export type QuestReward={id:string;threshold:number;name:string;goal:string;prize:string;description:string;enabled:boolean};
export type QuestUser={email:string;name:string;role:'collector'|'admin'};
export type QuestState={version:3;users:QuestUser[];collectibles:QuestCollectible[];codes:QuestCode[];rewards:QuestReward[];audit:{at:string;event:string;detail:string}[]};

const art='/assets/puckquest/art/';
export const questThemes:QuestTheme[]=[
 {id:'boston',name:'Boston',short:'BOS',division:'Atlantic',conference:'Eastern',image:`${art}boston-1800x1800.webp`},
 {id:'buffalo',name:'Buffalo',short:'BUF',division:'Atlantic',conference:'Eastern',image:`${art}buffalo-1800x1800.webp`},
 {id:'detroit',name:'Detroit',short:'DET',division:'Atlantic',conference:'Eastern',image:`${art}detroit-1800x1800.webp`},
 {id:'panthers',name:'Florida',short:'FLA',division:'Atlantic',conference:'Eastern',image:`${art}panthers-1800x1800.webp`},
 {id:'montreal',name:'Montreal',short:'MTL',division:'Atlantic',conference:'Eastern',image:`${art}montreal-1800x1800.webp`},
 {id:'ottawa',name:'Ottawa',short:'OTT',division:'Atlantic',conference:'Eastern',image:`${art}ottawa-1800x1800.webp`},
 {id:'lightning',name:'Tampa Bay',short:'TBL',division:'Atlantic',conference:'Eastern',image:`${art}lightning-1800x1800.webp`},
 {id:'toronto',name:'Toronto',short:'TOR',division:'Atlantic',conference:'Eastern',image:`${art}toronto-1800x1800.webp`},
 {id:'hurricanes',name:'Carolina',short:'CAR',division:'Metropolitan',conference:'Eastern',image:`${art}hurricanes-1800x1800.webp`},
 {id:'blue-jackets',name:'Columbus',short:'CBJ',division:'Metropolitan',conference:'Eastern',image:`${art}bluejakets-1800x1800.webp`},
 {id:'devils',name:'New Jersey',short:'NJD',division:'Metropolitan',conference:'Eastern',image:`${art}devils-1800x1800.webp`},
 {id:'long-island',name:'Long Island',short:'NYI',division:'Metropolitan',conference:'Eastern',image:`${art}long-island-1800x1800.webp`},
 {id:'rangers',name:'New York',short:'NYR',division:'Metropolitan',conference:'Eastern',image:`${art}ranger-1800x1800.webp`},
 {id:'flyers',name:'Philadelphia',short:'PHI',division:'Metropolitan',conference:'Eastern',image:`${art}flyers-1800x1800.webp`},
 {id:'penguins',name:'Pittsburgh',short:'PIT',division:'Metropolitan',conference:'Eastern',image:`${art}penguins-1800x1800.webp`},
 {id:'capitals',name:'Washington',short:'WSH',division:'Metropolitan',conference:'Eastern',image:`${art}capitols-1800x1800.webp`},
 {id:'blackhawks',name:'Chicago',short:'CHI',division:'Central',conference:'Western',image:`${art}blackhawks-1800x1800.webp`},
 {id:'colorado',name:'Colorado',short:'COL',division:'Central',conference:'Western',image:`${art}colorado-1800x1800.webp`},
 {id:'dallas',name:'Dallas',short:'DAL',division:'Central',conference:'Western',image:`${art}dallas-stars-1800-x-1800.webp`},
 {id:'wild',name:'Minnesota',short:'MIN',division:'Central',conference:'Western',image:`${art}wilds-1800x1800.webp`},
 {id:'predators',name:'Nashville',short:'NSH',division:'Central',conference:'Western',image:`${art}predators-1800x1800.webp`},
 {id:'blues',name:'St. Louis',short:'STL',division:'Central',conference:'Western',image:`${art}blues-1800x1800.webp`},
 {id:'utah',name:'Utah',short:'UTA',division:'Central',conference:'Western',image:`${art}utah-1800x1800.webp`},
 {id:'jets',name:'Winnipeg',short:'WPG',division:'Central',conference:'Western',image:`${art}jets-1800x1800.webp`},
 {id:'ducks',name:'Anaheim',short:'ANA',division:'Pacific',conference:'Western',image:`${art}ducks-1800x1800.webp`},
 {id:'calgary',name:'Calgary',short:'CGY',division:'Pacific',conference:'Western',image:`${art}calgary-1800x1800.webp`},
 {id:'oilers',name:'Edmonton',short:'EDM',division:'Pacific',conference:'Western',image:`${art}oilers-1800x1800.webp`},
 {id:'kings',name:'Los Angeles',short:'LAK',division:'Pacific',conference:'Western',image:`${art}kings-1800x1800.webp`},
 {id:'kraken',name:'Seattle',short:'SEA',division:'Pacific',conference:'Western',image:`${art}kracken-1800x1800.webp`},
 {id:'sharks',name:'San Jose',short:'SJS',division:'Pacific',conference:'Western',image:`${art}sharks-1800x1800.webp`},
 {id:'vancouver',name:'Vancouver',short:'VAN',division:'Pacific',conference:'Western',image:`${art}vancouver-1800x1800.webp`},
 {id:'knights',name:'Vegas',short:'VGK',division:'Pacific',conference:'Western',image:`${art}knights-1800x1800.webp`},
];

const collector='collector@puckquest.demo';
const today='2026-09-21T12:00:00.000Z';
const seedThemes=['boston','buffalo','montreal','lightning','toronto','rangers','kraken','boston'];

export function initialQuestState():QuestState{
 const collectibles:QuestCollectible[]=seedThemes.map((themeId,index)=>({
  id:`demo-${index+1}`,themeId,serial:`E1-${String(index+1).padStart(5,'0')}`,ownerEmail:collector,
  registeredAt:`2026-09-${String(8+index).padStart(2,'0')}T18:15:00.000Z`,status:'owned',
  history:[{at:`2026-09-${String(8+index).padStart(2,'0')}T18:15:00.000Z`,event:'registered',to:collector,note:'Claimed from sealed packet code'}]
 }));
 collectibles.push(
  {id:'market-chicago',themeId:'blackhawks',serial:'E1-00241',ownerEmail:'casey@puckquest.demo',registeredAt:'2026-09-11T14:20:00.000Z',status:'listed',history:[{at:'2026-09-11T14:20:00.000Z',event:'registered',to:'casey@puckquest.demo',note:'Claimed from sealed packet code'},{at:'2026-09-20T09:10:00.000Z',event:'listed',from:'casey@puckquest.demo',note:'Available for a Boston swap'}]},
  {id:'market-colorado',themeId:'colorado',serial:'E1-00312',ownerEmail:'jamie@puckquest.demo',registeredAt:'2026-09-13T17:05:00.000Z',status:'listed',history:[{at:'2026-09-13T17:05:00.000Z',event:'registered',to:'jamie@puckquest.demo',note:'Claimed from sealed packet code'},{at:'2026-09-19T10:40:00.000Z',event:'listed',from:'jamie@puckquest.demo',note:'Available for a Boston swap'}]},
  {id:'market-dallas',themeId:'dallas',serial:'E1-00408',ownerEmail:'riley@puckquest.demo',registeredAt:'2026-09-16T11:31:00.000Z',status:'listed',history:[{at:'2026-09-16T11:31:00.000Z',event:'registered',to:'riley@puckquest.demo',note:'Claimed from sealed packet code'},{at:'2026-09-20T12:05:00.000Z',event:'listed',from:'riley@puckquest.demo',note:'Available for a Boston swap'}]}
 );
 return {version:3,users:[
  {email:collector,name:'Alex Mercer',role:'collector'},
  {email:'admin@apexhockeypucks.com',name:'Apex Admin',role:'admin'},
  {email:'casey@puckquest.demo',name:'Casey',role:'collector'},
  {email:'jamie@puckquest.demo',name:'Jamie',role:'collector'},
  {email:'riley@puckquest.demo',name:'Riley',role:'collector'}
 ],collectibles,codes:[
  {code:'PQ-E1-BEAR-7K2M',themeId:'boston',status:'ready',createdAt:today},
  {code:'PQ-E1-KRAK-9V4Q',themeId:'kraken',status:'ready',createdAt:today},
  {code:'PQ-E1-BOLT-3H8R',themeId:'lightning',status:'ready',createdAt:today},
  {code:'PQ-E1-ICE9-2X7N',themeId:'colorado',status:'ready',createdAt:today},
  {code:'PQ-E1-USED-1A2B',themeId:'toronto',status:'redeemed',createdAt:'2026-09-08T18:15:00.000Z',redeemedAt:'2026-09-08T18:15:00.000Z',redeemedBy:collector,collectibleId:'demo-5'}
 ],rewards:[
  {id:'grand-same',threshold:32,name:'Grand Prize 1',goal:'All 32 teams · same edition',prize:'$5,000',description:'Complete all 32 team themes from one edition.',enabled:true},
  {id:'conference-same',threshold:16,name:'Elite Prize',goal:'Full conference · same edition',prize:'$2,000',description:'Complete all 16 teams in one conference from one edition.',enabled:true},
  {id:'grand-any',threshold:32,name:'Grand Prize 2',goal:'All 32 teams · any editions',prize:'$1,500',description:'Complete all 32 team themes across any editions.',enabled:true},
  {id:'conference-any',threshold:16,name:'Major Prize',goal:'Full conference · any editions',prize:'$750',description:'Complete all 16 teams in one conference across any editions.',enabled:true},
  {id:'legacy',threshold:2,name:'Legacy Prize',goal:'Every edition · one team',prize:'$500',description:'Own every released edition of one team theme.',enabled:true},
  {id:'division',threshold:8,name:'Medium Prize',goal:'Full division · any editions',prize:'$300',description:'Complete all eight teams in one division.',enabled:true},
  {id:'booster',threshold:5,name:'Booster Prize',goal:'Five of one team · same edition',prize:'$100',description:'Register five copies of the same team from one edition.',enabled:true},
  {id:'speed-30',threshold:32,name:'Speed Tier 1',goal:'Full same-edition set · 30 days',prize:'$1,000 bonus',description:'Finish a same-edition 32-team set within 30 calendar days.',enabled:true},
  {id:'speed-60',threshold:32,name:'Speed Tier 2',goal:'Full same-edition set · 60 days',prize:'$500 bonus',description:'Finish a same-edition 32-team set within 60 calendar days.',enabled:true},
  {id:'speed-90',threshold:32,name:'Speed Tier 3',goal:'Full same-edition set · 90 days',prize:'$250 bonus',description:'Finish a same-edition 32-team set within 90 calendar days.',enabled:true}
 ],audit:[{at:today,event:'demo_ready',detail:'PuckQuest demonstration ledger initialized'}]};
}

export const QUEST_STORAGE='apex-puckquest-demo-v3';
export const QUEST_SESSION='apex-puckquest-session-v2';
export const collectorDemo={email:collector,password:'Quest2026!'};
export const adminDemo={email:'admin@apexhockeypucks.com',password:'ApexQuest2026!'};
export function themeById(id:string){return questThemes.find(theme=>theme.id===id)!}
