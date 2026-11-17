function handler(event) {
  var request = event.request;
  if (request.uri === "/MediPoli") {
    return { statusCode: 308, statusDescription: "Permanent Redirect", headers: { location: { value: "/MediPoli/" } } };
  }
  if (request.uri.endsWith("/")) request.uri += "index.html";
  return request;
}
