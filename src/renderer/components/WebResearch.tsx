import { useState } from 'react';
import { ArrowUpRight, Globe2, Plus, Search } from 'lucide-react';
import type { AppSettings } from '../../shared/models';
import { httpsUrlSchema } from '../../shared/models';
import { scanningSettingsSchema } from '../../shared/intelligence';
import { bridge } from '../bridge';

export function BrowserResearch({query,location,onError}:{query:string;location:string;onError:(message:string)=>void}){
  const open=(provider:string)=>{const url=new URL(provider==='google'?'https://www.google.com/search':provider==='bing'?'https://www.bing.com/search':'https://search.brave.com/search');url.searchParams.set('q',`${location} ${query||'local events this weekend'}`);void bridge.openExternal(url.href).catch(error=>onError(String(error)));};
  return <div className="browser-research"><span><Search size={14}/>Continue research in your browser</span>{['google','bing','brave'].map(provider=><button key={provider} onClick={()=>open(provider)}>Search {provider[0].toUpperCase()+provider.slice(1)}<ArrowUpRight size={13}/></button>)}<small>Public results only. Bring a useful source URL back into Sources.</small></div>;
}
export function SourceAddition({onAdd}:{onAdd:(url:string)=>Promise<void>}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(event:React.FormEvent){event.preventDefault();setError('');const parsed=httpsUrlSchema.safeParse(url);if(!parsed.success){setError('Enter a public HTTPS source URL.');return;}setBusy(true);try{await onAdd(parsed.data);setUrl('');}catch(error){setError(String(error));}finally{setBusy(false);}}
  return <form className="source-addition" onSubmit={submit}><div><h3>Add a local source</h3><p>The engine checks the public page, advertised feeds, event metadata and regional relevance.</p></div><label className="sr-only" htmlFor="new-source-url">Public source URL</label><input id="new-source-url" value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://your-local-organization.org/events" type="url" required/><button className="button secondary" disabled={busy}><Plus size={15}/>{busy?'Adding…':'Analyze source'}</button>{error&&<p className="form-error" role="alert">{error}</p>}</form>;
}
export function SearchProviderPreferences({settings,onSave}:{settings:AppSettings;onSave:(settings:AppSettings)=>void}){
  const [endpoint,setEndpoint]=useState(settings.scanning.searchEndpoint),[error,setError]=useState('');
  const save=()=>{const parsed=scanningSettingsSchema.safeParse({...settings.scanning,searchEndpoint:endpoint.trim()});if(!parsed.success){setError('Use a public HTTPS SearXNG instance base URL, without credentials or query parameters.');return;}setError('');onSave({...settings,scanning:parsed.data});};
  return <section className="settings-panel panel"><div className="section-heading"><div><h2>Web discovery</h2><p>Independent providers, cached queries and source links.</p></div><Globe2 size={18}/></div><p className="field-help">Mwmbl's public index supplements the regional directory. Provider restrictions and failures appear in the scan log. Google, Bing and Brave also remain available as interactive browser research.</p><label className="field-label" htmlFor="search-endpoint">OPTIONAL SEARXNG INSTANCE</label><div className="inline-input"><input id="search-endpoint" value={endpoint} onChange={event=>setEndpoint(event.target.value)} placeholder="https://your-instance.example"/><button className="button secondary" onClick={save}>Save provider</button></div><p className="field-help">The instance must permit its documented JSON search API. No keys or accounts are required for the existing directory and source collectors. Your query and area are sent to configured providers.</p>{error&&<p className="form-error" role="alert">{error}</p>}</section>;
}
