import json
def cargar(p):
    """Lee el resultado de una consulta: JSON plano o la respuesta envuelta del conector de Supabase."""
    s=open(p).read()
    try: o=json.loads(s)
    except ValueError: o=None
    if isinstance(o,dict) and 'result' in o: s=o['result']
    elif isinstance(o,list) and o and isinstance(o[0],dict) and 'text' in o[0]: s=o[0]['text']
    else: return o
    a=s.index('\n[',s.index('<untrusted-data')); b=s.rindex('\n</untrusted-data')
    return json.loads(s[a+1:b])
def fila(p, clave):
    """Devuelve el objeto de la columna `clave` de la primera fila."""
    d=cargar(p); return d[0][clave] if isinstance(d,list) else d
