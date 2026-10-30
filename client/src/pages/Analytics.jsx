import { useMemo, useState } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import './Analytics.css';
const COLORS = ['#078753','#25a86e','#50bd91','#85d6b0','#0e6a50','#92bfa9'];
// Demonstration assumptions, NOT measured savings or actual trees saved.
const PAPER_GRAMS_PER_AVOIDED_RECEIPT = 1;
const CO2_KG_PER_KG_PAPER = 1;
const PAPER_KG_PER_TREE_EQUIVALENT = 8000;
const fmt = (n, digits=0) => Number(n||0).toLocaleString('en-PK',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const money = n => `Rs. ${fmt(n,2)}`;
const impact = count => {
  const paperKg = count * PAPER_GRAMS_PER_AVOIDED_RECEIPT / 1000;
  return {paperKg, co2Kg:paperKg*CO2_KG_PER_KG_PAPER, trees:paperKg/PAPER_KG_PER_TREE_EQUIVALENT};
};
function Metric({label,value,detail,icon}) {return <div className="ga-metric"><div className="ga-metric-top"><span>{label}</span><span className="ga-metric-icon">{icon}</span></div><div className="ga-metric-value">{value}</div><div className="ga-metric-detail">{detail}</div></div>}
function Panel({title,description,children}) {return <section className="ga-panel"><div className="ga-panel-header"><h3>{title}</h3><p>{description}</p></div>{children}</section>}
export default function Analytics({businesses=[],receiptCounts={},analyticsData=null,analyticsLoading=false,analyticsError='',onRefresh=()=>{}}) {
  const [search,setSearch]=useState('');
  const [selectedId,setSelectedId]=useState('');
  const records=useMemo(()=>businesses.map(b=>{
    const actual=analyticsData?.businesses?.find(x=>x.id===b.id);
    return {id:b.id,name:b.name||'Unnamed Business',type:b.type||'Other',plan:b.plan||'Basic',status:b.status||'disabled',receipts:Number(actual?.receipts??receiptCounts[b.id]??0),subscriptionRevenue:Number(actual?.subscriptionRevenue||0),subscriptionPayments:Number(actual?.subscriptionPayments||0)};
  }),[businesses,receiptCounts,analyticsData]);
  const totalReceipts=records.reduce((n,b)=>n+b.receipts,0);
  const verifiedRevenue=Number(analyticsData?.totals?.subscriptionRevenue||0);
  const verifiedPayments=Number(analyticsData?.totals?.verifiedPayments||0);
  const overall=impact(totalReceipts);
  const types=useMemo(()=>Object.values(records.reduce((groups,b)=>{const key=b.type;groups[key]??={name:key,businesses:0,receipts:0};groups[key].businesses++;groups[key].receipts+=b.receipts;return groups;},{})),[records]);
  const selected=records.find(b=>b.id===selectedId);
  const selectedImpact=selected?impact(selected.receipts):null;
  const monthly=analyticsData?.monthly||[];
  return <div className="ga-page">
    <div className="ga-page-header"><div><div className="ga-eyebrow">GOGREEN POS / ANALYTICS</div><h2>Platform Analytics</h2><p>GoGreen subscriptions, business adoption and digital environmental impact — without exposing stores' sales or profit.</p></div><button type="button" className="btn btn-outline-success" onClick={onRefresh} disabled={analyticsLoading}>{analyticsLoading?'Loading...':'↻ Refresh'}</button></div>
    {analyticsError&&<div className="alert alert-danger">{analyticsError}</div>}
    <div className="ga-section-heading"><div><h3>GoGreen Business Performance</h3><p>Subscription payments are separate from stores' POS sales.</p></div></div>
    <div className="ga-metric-grid">
      <Metric label="Verified Subscription Revenue" value={money(verifiedRevenue)} detail="Only verified subscription payments received by GoGreen" icon="Rs"/>
      <Metric label="Verified Payments" value={fmt(verifiedPayments)} detail="Payments approved by platform admin" icon="✓"/>
      <Metric label="GoGreen Profit" value="Not available" detail="Requires recorded GoGreen operating expenses" icon="↗"/>
      <Metric label="Total Businesses" value={fmt(records.length)} detail="Registered platform clients" icon="▣"/>
      <Metric label="Active Businesses" value={fmt(records.filter(b=>b.status==='active').length)} detail="Currently active" icon="◷"/>
      <Metric label="Digital Receipts" value={fmt(totalReceipts)} detail="All registered businesses combined" icon="▤"/>
      <Metric label="Est. Paper Avoided" value={`${fmt(overall.paperKg,3)} kg`} detail="Illustrative; assumes one receipt replaces 1 g of paper" icon="♻"/>
      <Metric label="Est. CO₂e Avoided" value={`${fmt(overall.co2Kg,3)} kg`} detail="Illustrative, not independently verified" icon="🌿"/>
      <Metric label="Tree Equivalent" value={fmt(overall.trees,6)} detail="Illustrative paper equivalent; not trees saved" icon="🌳"/>
    </div>
    <div className="ga-charts-grid">
      <Panel title="Businesses by Category" description="Distribution of registered businesses"><div className="ga-chart-area"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={types} dataKey="businesses" nameKey="name" innerRadius={55} outerRadius={95}>{types.map((x,i)=><Cell key={x.name} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer></div></Panel>
      <Panel title="Digital Receipts by Category" description="Digital adoption by business type"><div className="ga-chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={types}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name"/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="receipts" fill="#078753" name="Receipts"/></BarChart></ResponsiveContainer></div></Panel>
    </div>
    <Panel title="Monthly GoGreen Subscription Revenue" description="Only verified subscription payments — never store sales revenue"><div className="ga-wide-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthly}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="month"/><YAxis/><Tooltip/><Legend/><Bar dataKey="revenue" name="GoGreen revenue (PKR)" fill="#078753"/></BarChart></ResponsiveContainer></div>{!monthly.length&&<p>No verified subscription payment history yet. Set up subscription billing to populate this chart.</p>}</Panel>
    <div className="ga-individual-section"><div className="ga-section-heading"><div><h3>Individual Business Analytics</h3><p>Receipt and environmental metrics only. Store revenue and profit remain private.</p></div></div>
      <div className="ga-search-panel"><label htmlFor="ga-business-search">Search Business</label><div className="ga-search-row"><input id="ga-business-search" type="search" placeholder="Search business name..." value={search} onChange={e=>setSearch(e.target.value)}/>{selected&&<button type="button" onClick={()=>{setSelectedId('');setSearch('')}}>Clear Selection</button>}</div>
      {search.trim()&&<div className="ga-search-results">{records.filter(b=>b.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0,10).map(b=><button type="button" key={b.id} onClick={()=>{setSelectedId(b.id);setSearch('')}}><span><strong>{b.name}</strong><small>{b.type} · {b.plan}</small></span><span>View Impact →</span></button>)}</div>}</div>
      {!selected?<div className="ga-select-placeholder"><h4>Select a Business</h4><p>Search above to view receipt and environmental impact metrics.</p></div>:<><div className="ga-selected-header"><div><div className="ga-eyebrow">INDIVIDUAL IMPACT REPORT</div><h3>{selected.name}</h3><p>{selected.type} · {selected.plan} Plan</p></div><span className="ga-status">{selected.status}</span></div><div className="ga-metric-grid ga-individual-grid">
        <Metric label="Digital Receipts" value={fmt(selected.receipts)} detail="Generated by this business" icon="▤"/>
        <Metric label="Platform Receipt Share" value={`${fmt(totalReceipts?selected.receipts/totalReceipts*100:0,2)}%`} detail="Share of platform receipts" icon="◉"/>
        <Metric label="Est. Paper Avoided" value={`${fmt(selectedImpact.paperKg,3)} kg`} detail="Illustrative estimate" icon="♻"/>
        <Metric label="Est. CO₂e Avoided" value={`${fmt(selectedImpact.co2Kg,3)} kg`} detail="Illustrative estimate" icon="🌿"/>
        <Metric label="Tree Equivalent" value={fmt(selectedImpact.trees,6)} detail="Not actual trees saved" icon="🌳"/>
      </div></>}
    </div>
    <details className="ga-methodology"><summary>Environmental estimate assumptions</summary><div className="ga-methodology-content"><p>One digital receipt is assumed to replace one 1-gram paper receipt; a 100% replacement rate is assumed. CO₂e uses an illustrative factor of 1 kg per kg of paper; tree equivalent uses 8,000 kg of paper per tree. These figures are not validated environmental savings. Measure actual receipt weights and source an applicable lifecycle study before public claims.</p></div></details>
  </div>;
}
