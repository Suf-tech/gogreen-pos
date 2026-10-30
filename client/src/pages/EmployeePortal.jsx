import {useEffect,useState} from 'react';
import {sendSignInLinkToEmail,isSignInWithEmailLink,signInWithEmailLink,signOut} from 'firebase/auth';
import {auth} from '../firebase';
import OwnerBilling from './OwnerBilling';
import OwnerReturns from './OwnerReturns';
const API=import.meta.env.VITE_API_URL||'http://localhost:5000';
async function api(path,options={}){const u=auth.currentUser;if(!u)throw Error('Please sign in.');const r=await fetch(`${API}${path}`,{...options,headers:{Authorization:`Bearer ${await u.getIdToken()}`,...options.headers}});const d=await r.json();if(!r.ok||!d.success)throw Error(d.message||'Request failed');return d;}
export function EmployeeLogin(){
 const [email,setEmail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let alive=true;async function complete(){if(!isSignInWithEmailLink(auth,window.location.href))return;setBusy(true);try{
  let saved=window.localStorage.getItem('gogreenEmployeeEmail')||'';
  if(!saved)saved=window.prompt('Enter the employee email address that received this link:')||'';
  if(!saved)throw Error('Email is required to finish sign-in.');
  const credential=await signInWithEmailLink(auth,saved.trim(),window.location.href);
  const token=await credential.user.getIdToken(true);
  const r=await fetch(`${API}/api/employee/bootstrap`,{method:'POST',headers:{Authorization:`Bearer ${token}`}});
  const data=await r.json();if(!r.ok||!data.success)throw Error(data.message||'Employee account not registered.');
  window.localStorage.removeItem('gogreenEmployeeEmail');window.location.replace('/employee/dashboard');
 }catch(e){await signOut(auth).catch(()=>{});if(alive)setError(e.message)}finally{if(alive)setBusy(false)}}complete();return()=>{alive=false}},[]);
 async function send(e){e.preventDefault();setBusy(true);setError('');setMessage('');try{
  const value=email.trim().toLowerCase();
  await sendSignInLinkToEmail(auth,value,{url:`${window.location.origin}/employee/login`,handleCodeInApp:true});
  window.localStorage.setItem('gogreenEmployeeEmail',value);
  setMessage('Login link sent. Check your inbox and spam folder. Open the link to sign in.');
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 return <div style={{maxWidth:440,margin:'9vh auto',padding:25,background:'#fff',borderRadius:12}}><h2>GoGreen POS · Employee Login</h2><p>Enter the email registered by your owner. We will send a secure sign-in link. No password needed.</p>{error&&<p style={{color:'crimson'}}>{error}</p>}{message&&<p style={{color:'green'}}>{message}</p>}<form onSubmit={send}><label>Employee Email<input style={{display:'block',width:'100%',padding:12,marginBottom:14}} type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><button disabled={busy} className="btn btn-success">{busy?'Please wait...':'Send Login Link'}</button></form></div>}
export function EmployeeDashboard(){const[tab,setTab]=useState('billing'),[info,setInfo]=useState(null),[products,setProducts]=useState([]),[error,setError]=useState('');useEffect(()=>{api('/api/employee/me').then(setInfo).catch(e=>setError(e.message))},[]);useEffect(()=>{if(tab==='inventory')api('/api/owner/products/').then(d=>setProducts(d.products||[])).catch(e=>setError(e.message))},[tab]);if(error)return <div style={{padding:35}}><p style={{color:'crimson'}}>{error}</p><button onClick={()=>signOut(auth)}>Sign out</button></div>;if(!info)return <p style={{padding:35}}>Verifying employee access...</p>;return <div style={{padding:24,maxWidth:1300,margin:'auto'}}><header style={{display:'flex',justifyContent:'space-between',gap:15,alignItems:'center',flexWrap:'wrap'}}><div><h2>GoGreen POS · Employee Workspace</h2><p>{info.businessName} · {info.email}</p></div><button className="btn btn-outline-danger" onClick={()=>signOut(auth)}>Logout</button></header><nav style={{display:'flex',gap:10,margin:'20px 0',flexWrap:'wrap'}}>{[['billing','Billing / POS'],['inventory','Inventory (view only)'],['returns','Returns & Refunds'],['receipts','Digital Receipts']].map(([id,label])=><button key={id} className={'btn '+(tab===id?'btn-success':'btn-outline-success')} onClick={()=>setTab(id)}>{label}</button>)}</nav>{tab==='billing'?<OwnerBilling business={{id:info.businessId,name:info.businessName}}/>:tab==='returns'?<OwnerReturns/>:tab==='inventory'?<section><h3>Products & Stock</h3><table className="table"><thead><tr><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th></tr></thead><tbody>{products.map(p=><tr key={p.id}><td>{p.name}</td><td>{p.sku}</td><td>Rs. {p.sellingPrice}</td><td>{p.stock}</td></tr>)}</tbody></table></section>:<EmployeeReceipts/>}</div>}
function EmployeeReceipts(){const[rows,setRows]=useState([]),[error,setError]=useState('');useEffect(()=>{api('/api/owner/billing/sales').then(d=>setRows(d.sales||[])).catch(e=>setError(e.message))},[]);return <section><h3>Recent Receipts</h3>{error&&<p style={{color:'crimson'}}>{error}</p>}<table className="table"><thead><tr><th>Receipt</th><th>Total</th><th>Date</th></tr></thead><tbody>{rows.map(s=><tr key={s.id}><td>{s.receiptNumber}</td><td>Rs. {s.total}</td><td>{s.createdAt?new Date(s.createdAt).toLocaleString():'-'}</td></tr>)}</tbody></table></section>}
