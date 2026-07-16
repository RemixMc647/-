document.getElementById("logoutBtn").onclick=()=>{

if(confirm("Logout of Remix Nexus?")){

AUTH.logout();

location.href="index.html";

}

};

document.getElementById("clearChats").onclick=()=>{

if(confirm("Clear every chat?")){

localStorage.removeItem("remix-nexusMessages");

localStorage.removeItem("remix-nexusUnreadRooms");

localStorage.removeItem("remix-nexusUnreadContacts");

alert("Chats cleared.");

}

};