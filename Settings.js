document.getElementById("logoutBtn").onclick=()=>{

if(confirm("Logout of Remix Nexus?")){

AUTH.logout();

location.href="index.html";

}

};

document.getElementById('clearChats').onclick = () => {
  if (!confirm('Clear all chats on this device? This will not delete messages for other users.')) {
    return;
  }

  // Room chats
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith('remix-nexusMessages:')) {
      localStorage.removeItem(key);
    }

    // DM chats
    if (key.startsWith('remix-nexusDM')) {
      localStorage.removeItem(key);
    }

    // Unread counters
    if (key.startsWith('remix-nexusUnreadRooms:') ||
        key.startsWith('remix-nexusUnreadContacts:')) {
      localStorage.removeItem(key);
    }
  });

  alert('All local chats have been cleared.');
  location.reload();
};