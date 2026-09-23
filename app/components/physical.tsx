'use client';

import {useEffect,useRef,useState, type ReactNode, type CSSProperties, type PointerEvent} from 'react';
import Link from './link';
import {ArrowDown,ArrowUpRight,RotateCcw,ChevronLeft,ChevronRight,MoveHorizontal,Plus,Minus} from 'lucide-react';
import {Slider} from '@/components/ui/slider';
import type {Product} from '@/lib/apex';

const reduced=()=>typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export function useInertia(amount=7){
 const ref=useRef<HTMLDivElement>(null),motion=useRef({x:0,y:0,tx:0,ty:0,raf:0});
 useEffect(()=>()=>cancelAnimationFrame(motion.current.raf),[]);
 function move(x:number,y:number){const m=motion.current;m.tx=x;m.ty=y;if(m.raf||reduced())return;const tick=()=>{m.x+=(m.tx-m.x)*.12;m.y+=(m.ty-m.y)*.12;ref.current?.style.setProperty('--tilt-x',`${m.y.toFixed(2)}deg`);ref.current?.style.setProperty('--tilt-y',`${m.x.toFixed(2)}deg`);if(Math.abs(m.tx-m.x)+Math.abs(m.ty-m.y)>.02)m.raf=requestAnimationFrame(tick);else m.raf=0};m.raf=requestAnimationFrame(tick)}
 return {ref,onPointerMove:(e:PointerEvent<HTMLDivElement>)=>{if(e.pointerType==='touch'&&!e.buttons)return;const b=e.currentTarget.getBoundingClientRect();move((e.clientX-b.left-b.width/2)/b.width*amount,-(e.clientY-b.top-b.height/2)/b.height*amount)},onPointerLeave:()=>move(0,0),onPointerUp:()=>move(0,0)};
}
export function PuckSurface({children,className=''}:{children:ReactNode;className?:string}){const movement=useInertia();return <div className={`physical-surface ${className}`} {...movement}><div className="physical-object">{children}</div></div>}

export function MotionSystem(){
 useEffect(()=>{const root=document.documentElement;let frame=0;function update(){frame=0;const max=root.scrollHeight-innerHeight;root.style.setProperty('--page-progress',String(max>0?scrollY/max:0));root.dataset.scrolled=scrollY>36?'true':'false'}function queue(){if(!frame)frame=requestAnimationFrame(update)}update();addEventListener('scroll',queue,{passive:true});addEventListener('resize',queue);return()=>{cancelAnimationFrame(frame);removeEventListener('scroll',queue);removeEventListener('resize',queue)}},[]);
 return <div className="scroll-pressure" aria-hidden="true"><span/></div>;
}

export function ImpactHero(){const [take,setTake]=useState(0);return <section className="impact-hero">
 <div className="impact-register"><span>APEX / HOCKEY PUCKS</span><span>AMERICAN ENGINEERING · SRI LANKAN CRAFT</span></div>
 <div className="impact-title"><p className="eyebrow">THE GAME STARTS HERE.</p><h1><span>SMALL PUCK.</span><strong>BIG GAME.</strong></h1></div>
 <div className="impact-arena" key={take}>
  <div className="ice-plane" aria-hidden="true"><i/><i/><i/><span className="rink-center"/></div>
  <div className="pressure-ring ring-one" aria-hidden="true"/><div className="pressure-ring ring-two" aria-hidden="true"/>
  <div className="impact-shadow" aria-hidden="true"/>
  <div className="puck-arrival"><PuckSurface className="impact-puck"><img src="/assets/hero-puck.webp" alt="Apex black rubber hockey puck, its deeply knurled edge catching the light" width="1000" height="1000" fetchPriority="high" draggable="false"/></PuckSurface></div>
  <div className="ice-spray" aria-hidden="true">{Array.from({length:16},(_,i)=><i key={i} style={{'--i':i,'--dx':`${(i%2?1:-1)*(65+i*13)}px`,'--dy':`${-30-(i%5)*19}px`} as CSSProperties}/>)}</div>
  <div className="impact-callout"><span className="precision-point"/><span>01 / THE EDGE<br/><b>CONTROL STARTS HERE.</b></span></div>
 </div>
 <div className="impact-copy"><p>Black rubber. Relentless purpose.<br/>From our factory to your next faceoff.</p><div className="hero-buttons"><Link className="btn" href="/shop">Find your puck <ArrowUpRight size={18}/></Link><Link className="hero-secondary" href="/custom-pucks">Make it yours <ArrowUpRight size={18}/></Link></div></div>
 <div className="impact-bottom"><a href="#lineup"><ArrowDown size={16}/> EXPLORE THE LINEUP</a><span>BUILT FOR THE DROP.</span><button onClick={()=>setTake(t=>t+1)} aria-label="Replay the puck entrance"><RotateCcw size={15}/> Replay the drop</button></div>
 </section>}

export function EquipmentGallery({product:p}:{product:Product}){
 const [photo,setPhoto]=useState(0),[zoom,setZoom]=useState(false),[frame,setFrame]=useState<number|null>(null),[dragging,setDragging]=useState(false);
 const start=useRef({x:0,y:0,photo:0,frame:0}),last=useRef(0);const pro=p.handle==='apex-pro-markless-ice-hockey-pucks',collect=p.category==='Collectibles';
 const label=collect?'SERIAL / EDITION 1':photo===1?'THE EMBOSSED EDGE':photo===2?'THE APEX SIGNATURE':pro?'MARKLESS RUBBER':'TIGHT EDGE KNURLING';
 function down(e:PointerEvent<HTMLDivElement>){if(e.button!==0)return;start.current={x:e.clientX,y:e.clientY,photo,frame:frame??0};last.current=0;setDragging(true);e.currentTarget.setPointerCapture(e.pointerId)}
 function move(e:PointerEvent<HTMLDivElement>){if(!dragging)return;const dx=e.clientX-start.current.x;if(Math.abs(e.clientY-start.current.y)>Math.abs(dx)*1.3&&e.pointerType==='touch')return;const step=Math.trunc(dx/(pro?9:65));if(pro){setFrame(((start.current.frame+step)%36+36)%36)}else if(step!==last.current){setPhoto(((start.current.photo+step)%p.images.length+p.images.length)%p.images.length)}last.current=step}
 function end(){setDragging(false)}
 function show(i:number){setFrame(null);setPhoto((i+p.images.length)%p.images.length)}
 return <div className={`product-gallery equipment-gallery ${collect?'collectible-gallery':''}`}>
 <div className={`equipment-stage ${zoom?'macro-mode':''} ${dragging?'is-dragging':''}`} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
  <div className="equipment-register"><span>{p.category.toUpperCase()}</span><span>APEX / 0{collect?3:pro?2:1}</span></div>
  <div className="equipment-orbit" aria-hidden="true"/>
  <PuckSurface className="equipment-object"><img key={frame===null?photo:'rotation'} src={frame===null?p.images[photo]:`/assets/rotation/${frame}.webp`} alt={frame===null?`${p.title} — view ${photo+1}`:`APEX PRO rotation — ${frame*10} degrees`} width="1000" height="1000" draggable="false"/></PuckSurface>
  <div className="equipment-callout"><span className="precision-point"/><span>{label}<small>{collect?'A collection with an identity.':'Precision you can put your hands on.'}</small></span></div>
  <div className="equipment-bottom"><span><MoveHorizontal size={16}/>{pro?'DRAG TO ROTATE':'SWIPE TO EXPLORE'}</span><button className="macro-toggle" onPointerDown={e=>e.stopPropagation()} onClick={()=>setZoom(z=>!z)} aria-pressed={zoom}>{zoom?<Minus size={17}/>:<Plus size={17}/>} {zoom?'Full puck':'Inspect detail'}</button></div>
 </div>
 <div className="gallery-control-bar"><button aria-label="Previous product view" onClick={()=>show(photo-1)}><ChevronLeft size={20}/></button><div className="gallery-thumbs">{p.images.map((src,i)=><button key={src} aria-label={`View product image ${i+1}`} aria-pressed={photo===i&&frame===null} onClick={()=>show(i)}><img src={src} alt="" width="80" height="80" loading="lazy"/></button>)}</div><button aria-label="Next product view" onClick={()=>show(photo+1)}><ChevronRight size={20}/></button></div>
 {pro&&<div className="technical-rotation"><span id="product-rotation-label">360° product study</span><Slider aria-labelledby="product-rotation-label" min={0} max={35} step={1} value={[frame??0]} onValueChange={v=>setFrame(v[0])}/></div>}
 <div className="equipment-specs">{(collect?['MYSTERY PACKS','UNIQUE SERIAL','EDITION 1']:['KNURLED EDGE',pro?'MARKLESS RUBBER':'GAME & PRACTICE','SRI LANKAN MADE']).map((s,i)=><span key={s}><small>0{i+1}</small>{s}</span>)}</div>
 </div>
}

const stages=[
 {title:'RAW RUBBER.',code:'01 / MATERIAL',copy:'Locally sourced Sri Lankan raw materials. The foundation of the Apex puck.',detail:'MATERIAL SELECTION',position:'material'},
 {title:'UNDER PRESSURE.',code:'02 / FORM',copy:'A dedicated hockey-puck facility. One focus: the compound, the form and a consistent puck.',detail:'DEDICATED PUCK MANUFACTURING',position:'form'},
 {title:'FIND YOUR EDGE.',code:'03 / KNURL',copy:'Tight knurling gives the stick a textured contact surface. Small geometry. A meaningful connection.',detail:'TIGHT KNURLED EDGE',position:'edge'},
 {title:'EVERY PUCK COUNTS.',code:'04 / TEST + INSPECT',copy:'Apex describes laboratory testing and individual quality assessments as part of its manufacturing process.',detail:'CONSISTENCY BY DESIGN',position:'test'},
 {title:'MAKE YOUR MARK.',code:'05 / PRINT',copy:'Your team identity meets Apex’s own ink blend. Request a sample to feel the rubber and evaluate the print.',detail:'CUSTOM LOGO PRINTING',position:'print'},
 {title:'BUILT FOR THE ICE.',code:'06 / SHIP + PLAY',copy:'From the factory to your game. Standard packs, team orders and custom runs, direct from Apex.',detail:'FROM OUR FACTORY. TO YOUR GAME.',position:'ice'}
];
export function ManufacturingSequence(){const [stage,setStage]=useState(0);const s=stages[stage];return <section className="production-sequence"><div className="production-top"><p className="eyebrow">MATERIAL → MATCH</p><p>Follow the puck.</p></div><div className="production-tabs" role="tablist" aria-label="Explore puck manufacturing">{stages.map((s,i)=><button key={s.code} id={`process-tab-${i}`} role="tab" aria-selected={stage===i} aria-controls="production-panel" tabIndex={stage===i?0:-1} onClick={()=>setStage(i)} onKeyDown={e=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?5:(stage+(e.key==='ArrowRight'?1:5))%6;setStage(next);document.getElementById(`process-tab-${next}`)?.focus()}}}><small>0{i+1}</small>{['MATERIAL','FORM','KNURL','TEST','PRINT','ICE'][i]}</button>)}</div><div role="tabpanel" id="production-panel" aria-labelledby={`process-tab-${stage}`} className={`production-panel stage-${s.position}`}><div className="production-macro" key={s.position}><img src={stage===4?'/assets/custom.webp':'/assets/hero-puck.webp'} alt={stage===4?'Apex puck with its real printed logo':'Macro study of the real Apex rubber puck and knurled edge'} width="1000" height="1000" loading="lazy"/><span className="macro-crosshair" aria-hidden="true"/></div><div className="production-caption" key={s.code}><p className="eyebrow">{s.code}</p><h2>{s.title}</h2><p>{s.copy}</p><span className="production-detail">{s.detail}</span></div></div><div className="production-foot"><span>AMERICAN ENGINEERING / SRI LANKAN PRODUCTION</span><span>APEX PRODUCT STUDY</span></div></section>}

export function MacroBreak(){return <section className="macro-break"><img src="/assets/hero-puck.webp" alt="Close-up of Apex’s knurled rubber edge" width="1000" height="1000" loading="lazy"/><div><p className="eyebrow">THE POINT OF CONTACT.</p><h2>FEEL<br/>EVERY<br/><em>EDGE.</em></h2><p>Tight knurling. Purposeful rubber.<br/>Control starts at the surface.</p><Link href="/manufacturing" className="text-link">Explore the engineering <ArrowUpRight size={18}/></Link></div><span className="macro-index" aria-hidden="true">APEX / MATERIAL STUDY 01</span></section>}
