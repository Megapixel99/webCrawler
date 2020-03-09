$.ajax({
  url: '/results' + window.location.search,
  type: "GET",
  success: function(data) {
    if (!data)
      alert("Error - no data was recived from the server")
    else if (data.length === 0) {
      $("#root").append("<p>No results found</p>");
    } else {
      if (data instanceof Array) {
        for (var i = 0; i < data.length; i++) {
          $("#root").append("<a href= " + data[i].Url + " > " + data[i].Title +
            " </a><br>");
        }
      } else {
        alert("An unknown error occured")
      }
      var qs = (function(a) {
        if (a == "") return {};
        var b = {};
        for (var i = 0; i < a.length; ++i) {
          var p = a[i].split('=', 2);
          if (p.length == 1)
            b[p[0]] = "";
          else
            b[p[0]] = decodeURIComponent(p[1].replace(/\+/g, " "));
        }
        return b;
      })(window.location.search.substr(1).split('&'));
      document.getElementById('q').value = qs["q"];
    }
  }
});