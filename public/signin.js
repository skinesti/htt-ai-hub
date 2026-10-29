(function(){var p=new URLSearchParams(location.search),m=document.getElementById('message');
if(p.get('error')==='denied')m.textContent='This Google account is not approved for this app. Sign in with your approved work account.';
else if(p.get('error')==='failed')m.textContent='Sign-in did not complete. Please try again.';
else if(p.has('signed-out')){m.className='message info';m.textContent='You are signed out.';}})();
