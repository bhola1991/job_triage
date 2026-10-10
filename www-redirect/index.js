// www.jobtriage.in -> jobtriage.in. A redirect, not a second address for the
// app: everything the app stores in the browser is keyed to the origin, so
// serving it on www would give the same person two separate sets of jobs.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'jobtriage.in';
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  },
};
