import {themeById} from '@/lib/puckquest';

type QuestPuckProps={
 themeId:string;
 className?:string;
 eager?:boolean;
 keytag?:boolean;
 size?:number;
};

/**
 * One physical PuckQuest mini puck. The square source artwork is intentionally
 * clipped inside the printable face, while the rubber body, bevel and keyring
 * remain outside that print mask.
 */
export function QuestPuck({themeId,className='',eager=false,keytag=false,size=600}:QuestPuckProps){
 const theme=themeById(themeId);
 return <span className={`pq-puck quest-disc ${keytag?'quest-disc--keytag':''} ${className}`}>
  {keytag&&<span className="quest-disc-keyring" aria-hidden="true"><i/><b/></span>}
  <span className="pq-puck-edge quest-disc-edge" aria-hidden="true"/>
  <span className="pq-puck-face quest-disc-face">
   <img src={theme.image} alt={`${theme.name} Edition 01 printed mini puck`} width={size} height={size} loading={eager?'eager':'lazy'} decoding={eager?'sync':'async'} draggable="false"/>
   <span className="pq-puck-gloss quest-disc-print" aria-hidden="true"/>
  </span>
 </span>;
}
