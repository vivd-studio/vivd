import type { TableBookingPluginConfig } from "./config";

export interface TableBookingSnippetSet {
  html: string;
  astro: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSubmitScript(options: {
  format: "html" | "astro";
  availabilityEndpoint: string;
  defaultButtonLabel: string;
  collectNotes: boolean;
}): string {
  const scriptTag = options.format === "astro" ? "<script is:inline>" : "<script>";

  return `${scriptTag}
(function(){
  function renderSlots(root, slots){
    var list=root.querySelector("[data-vivd-booking-slots]");
    if(!list)return;
    list.innerHTML="";
    if(!slots||!slots.length){
      list.textContent="No online slots available for that date and party size.";
      return;
    }
    slots.forEach(function(slot){
      var button=document.createElement("button");
      button.type="button";
      button.textContent=slot.label||slot.time;
      button.className="vivd-booking-slot";
      button.addEventListener("click",function(){
        var timeField=root.querySelector('input[name="time"]');
        if(timeField)timeField.value=slot.time;
      });
      list.appendChild(button);
    });
  }

  function bind(root){
    if(!root||root.getAttribute("data-vivd-table-booking-bound")==="1")return;
    var form=root.querySelector("form");
    var status=root.querySelector("[data-vivd-status]");
    var submit=form&&form.querySelector('[type="submit"]');
    var dateField=form&&form.querySelector('input[name="date"]');
    var partyField=form&&form.querySelector('input[name="partySize"]');
    if(!form||!status||!submit||!dateField||!partyField)return;
    root.setAttribute("data-vivd-table-booking-bound","1");
    var baseLabel=submit.textContent||"${escapeHtml(options.defaultButtonLabel)}";

    function loadAvailability(){
      if(!dateField.value||!partyField.value)return;
      var tokenField=form.querySelector('input[name="token"]');
      if(!tokenField||!tokenField.value)return;
      var url=new URL("${escapeHtml(options.availabilityEndpoint)}", window.location.origin);
      url.searchParams.set("token", tokenField.value);
      url.searchParams.set("date", dateField.value);
      url.searchParams.set("partySize", partyField.value);
      fetch(url.toString(),{headers:{Accept:"application/json"}})
        .then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{ok:r.ok,data:j}})})
        .then(function(result){
          if(result.ok&&result.data&&result.data.ok){
            renderSlots(root, result.data.slots||[]);
            return;
          }
          throw new Error(result.data&&result.data.error&&result.data.error.message||"");
        })
        .catch(function(error){
          var list=root.querySelector("[data-vivd-booking-slots]");
          if(list)list.textContent=error.message||"Could not load slots.";
        });
    }

    dateField.addEventListener("change", loadAvailability);
    partyField.addEventListener("change", loadAvailability);

    form.addEventListener("submit",function(event){
      event.preventDefault();
      submit.disabled=true;
      submit.textContent="Booking\\u2026";
      status.style.display="none";
      var fd=new FormData(form),body={};
      fd.forEach(function(value,key){body[key]=value});
      fetch(form.action,{
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify(body)
      })
      .then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{ok:r.ok,data:j}})})
      .then(function(result){
        if(result.ok&&result.data&&result.data.ok){
          form.style.display="none";
          status.textContent="Your booking request was confirmed. Please check your email.";
          status.style.display="";
          return;
        }
        throw new Error(result.data&&result.data.error&&result.data.error.message||"");
      })
      .catch(function(error){
        status.textContent=error.message||"Something went wrong. Please try again.";
        status.style.display="";
        submit.disabled=false;
        submit.textContent=baseLabel;
      });
    });
  }

  var script=document.currentScript;
  var sibling=script&&script.previousElementSibling;
  if(sibling&&sibling.matches&&sibling.matches("[data-vivd-table-booking-form]")){
    bind(sibling);
    return;
  }
  var roots=document.querySelectorAll("[data-vivd-table-booking-form]");
  for(var i=0;i<roots.length;i++)bind(roots[i]);
})();
</script>`;
}

function formatSnippet(
  token: string,
  endpoints: {
    availabilityEndpoint: string;
    bookEndpoint: string;
  },
  config: TableBookingPluginConfig,
  format: "html" | "astro",
): string {
  const comment =
    format === "astro"
      ? "{/* Table booking (Vivd table_booking plugin) */}"
      : "<!-- Table booking (Vivd table_booking plugin) -->";

  const notesField = config.collectNotes
    ? `\n  <label>\n    <span>Notes</span>\n    <textarea name="notes" rows="3"></textarea>\n  </label>`
    : "";

  return `${comment}
<div data-vivd-table-booking-form>
<form method="POST" action="${escapeHtml(endpoints.bookEndpoint)}">
  <input type="hidden" name="token" value="${escapeHtml(token)}" />
  <input type="text" name="_honeypot" style="display:none" tabindex="-1" autocomplete="off" />
  <label>
    <span>Date</span>
    <input type="date" name="date" required />
  </label>
  <label>
    <span>Party size</span>
    <input type="number" name="partySize" min="${config.partySize.min}" max="${config.partySize.max}" value="${config.partySize.min}" required />
  </label>
  <div data-vivd-booking-slots style="display:flex;flex-wrap:wrap;gap:8px"></div>
  <label>
    <span>Time</span>
    <input type="time" name="time" required />
  </label>
  <label>
    <span>Name</span>
    <input type="text" name="name" required autocomplete="name" />
  </label>
  <label>
    <span>Email</span>
    <input type="email" name="email" required autocomplete="email" />
  </label>
  <label>
    <span>Phone</span>
    <input type="tel" name="phone" required autocomplete="tel" />
  </label>${notesField}
  <button type="submit">Book table</button>
</form>
<div data-vivd-status style="display:none"></div>
</div>
${buildSubmitScript({
  format,
  availabilityEndpoint: endpoints.availabilityEndpoint,
  defaultButtonLabel: "Book table",
  collectNotes: config.collectNotes,
})}`;
}

export function getTableBookingSnippets(
  token: string,
  endpoints: {
    availabilityEndpoint: string;
    bookEndpoint: string;
  },
  config: TableBookingPluginConfig,
): TableBookingSnippetSet {
  return {
    html: formatSnippet(token, endpoints, config, "html"),
    astro: formatSnippet(token, endpoints, config, "astro"),
  };
}
