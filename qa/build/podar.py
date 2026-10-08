# deja en el tar solo los segmentos de WAL que hacen falta y lo comprime
import tarfile,json,gzip,io
w=json.load(open('build/wal.json')); keep={w['r'],w['c']}
src=tarfile.open('build/datos.tar'); buf=io.BytesIO(); dst=tarfile.open(fileobj=buf,mode='w')
for m in src.getmembers():
    n=m.name.split('/')[-1]
    if '/pg_wal/' in m.name and len(n)==24 and n not in keep: continue
    dst.addfile(m, src.extractfile(m) if m.isfile() else None)
dst.close()
open('build/datos.tgz','wb').write(gzip.compress(buf.getvalue(),9))
open('build/tickets_cache.csv.gz','wb').write(gzip.compress(open('build/tickets_cache.csv','rb').read(),9))
import os;print(keep, os.path.getsize('build/datos.tgz'), os.path.getsize('build/tickets_cache.csv.gz'))
