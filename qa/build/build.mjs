import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import fs from 'fs';
const S = JSON.parse(fs.readFileSync('build/esquema_stmts.json','utf8'));
const db = await PGlite.create({ extensions: { pgcrypto, uuid_ossp } });
async function correr(lista, nombre){
  let pend = lista;
  for (let r=0; pend.length && r<5; r++) {
    const fail=[];
    for (const s of pend) { try { await db.exec(s); } catch(e) { fail.push([s,e.message]); } }
    if (fail.length===pend.length) { for (const [s,m] of fail) console.log('FALLA',nombre,m,'::',s.slice(0,200)); break; }
    pend = fail.map(f=>f[0]);
  }
}
await correr(S.pre,'pre');
// datos
const chicas = (()=>{ let o=JSON.parse(fs.readFileSync('raw/chicas.txt','utf8')); if (o.result) { const s=o.result; const a=s.indexOf('\n[',s.indexOf('<untrusted-data')); const b=s.lastIndexOf('\n</untrusted-data'); o=JSON.parse(s.slice(a+1,b)); } return Array.isArray(o) ? o[0].j : o; })();
const tablas = {};
for (const [t,v] of Object.entries(chicas)) if (t!=='pad' && v) tablas[t]=v;
for (const f of ['bases','reclamos']) { const j=JSON.parse(fs.readFileSync(`raw/${f}.json`,'utf8')); tablas[f]=j.rows.map(r=>Object.fromEntries(j.cols.map((c,i)=>[c,r[i]]))); }
const orden = ['operarios','estados_asistencia','causas_std','motivos_cambio_fecha','tipos_extra','ofs','bases','of_generada'];
const lista = [...orden.filter(t=>tablas[t]), ...Object.keys(tablas).filter(t=>!orden.includes(t))];
for (const t of lista) {
  const filas = tablas[t];
  const cols = (await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1 and is_generated='NEVER' order by ordinal_position`,[t])).rows.map(r=>r.column_name).filter(c=>c in filas[0]);
  const cl = cols.map(c=>`"${c}"`).join(',');
  for (let i=0;i<filas.length;i+=5000) {
    try { await db.query(`insert into public.${t} (${cl}) overriding system value select ${cl} from json_populate_recordset(null::public.${t}, $1::json)`, [JSON.stringify(filas.slice(i,i+5000))]); }
    catch(e){ console.log('DATOS',t,e.message); break; }
  }
  console.log(t, (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n);
}
// la oficina queda solo con su usuario (sin nombre completo)
await db.exec(`update operarios set nombres_apellidos = dni where dni !~ '^[0-9]{8}$'`);
await correr(S.post,'post');
// secuencias e identidades
for (const s of S.seqs) { try { await db.query(`select setval('public.${s.s}', greatest($1::bigint,1))`,[s.v]); } catch(e){} }
const ids = (await db.query(`select table_name t, column_name c from information_schema.columns where table_schema='public' and is_identity='YES'`)).rows;
for (const {t,c} of ids) await db.exec(`select setval(pg_get_serial_sequence('public.${t}','${c}'), coalesce((select max("${c}") from public.${t}),0)+1, false)`);
// tickets_cache se arma con la función real
const areas = (await db.query(`select distinct area from of_generada`)).rows;
const t0=Date.now();
for (const {area} of areas) { try { await db.query(`select fn_tickets_cache_refrescar($1)`,[area]); } catch(e){ console.log('TC',area,e.message); } }
console.log('tickets_cache', (await db.query(`select area, count(*)::int n from tickets_cache group by 1 order by 1`)).rows, Date.now()-t0,'ms');
if (process.argv[2]==='dump') {
  const tc = await db.query(`copy (select * from tickets_cache order by area, codigo) to '/dev/blob' with (format csv)`);
  fs.writeFileSync('build/tickets_cache.csv', Buffer.from(await tc.blob.arrayBuffer()));
  await db.exec('truncate tickets_cache');
  for (const q of ['vacuum full','vacuum analyze','checkpoint']) await db.exec(q);
  console.log('tam', (await db.query("select pg_size_pretty(pg_database_size(current_database())) s")).rows[0].s);
  const w=(await db.query("select pg_walfile_name(redo_lsn) r, pg_walfile_name(pg_current_wal_insert_lsn()) c from pg_control_checkpoint()")).rows[0]; fs.writeFileSync('build/wal.json', JSON.stringify(w)); console.log(w);
  const f=await db.dumpDataDir('none'); fs.writeFileSync('build/datos.tar', Buffer.from(await f.arrayBuffer()));
  await db.close();
}
export { db };
