/** Google GIS redirect — POST credential, rồi về app (sessionStorage). */
export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return Response.redirect(new URL('/', context.request.url), 302)
  }
  const form = await context.request.formData()
  const cred = String(form.get('credential') || '')
  const html = `<!doctype html><meta charset="utf-8"><title>3SU</title><script>
try{sessionStorage.setItem('3su:gisId',${JSON.stringify(cred)})}catch(e){}
location.replace('/')
</script>`
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
