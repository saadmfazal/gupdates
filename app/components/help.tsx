'use client';
import {useState} from 'react';
import {Search} from 'lucide-react';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {FAQList} from './store';
import {faqs} from '@/lib/apex';
export function Help(){const [query,setQuery]=useState(''),[group,setGroup]=useState('All questions');const items=faqs.filter(f=>(group==='All questions'||f.group===group)&&`${f.q} ${f.a}`.toLowerCase().includes(query.toLowerCase()));return <div className="help-layout"><aside><div className="search-field"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search questions" aria-label="Search questions"/></div><RadioGroup className="help-categories" aria-label="Question category" value={group} onValueChange={setGroup}>{['All questions','Products','Custom printing','Team orders','Delivery & returns'].map(g=><label key={g} className={group===g?'active':''}><RadioGroupItem value={g} className="sr-only"/>{g}</label>)}</RadioGroup></aside><div><p className="result-count" aria-live="polite">{items.length} QUESTIONS</p><FAQList items={items}/>{!items.length&&<div className="no-results"><h2>No matching questions.</h2><button className="btn outline" onClick={()=>{setQuery('');setGroup('All questions')}}>Clear search</button></div>}</div></div>}
