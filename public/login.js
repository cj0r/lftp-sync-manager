// Initialize Lucide Icons
lucide.createIcons();

const loginForm = document.getElementById('login-form');
const mfaGroup = document.getElementById('mfa-group');
const mfaCodeInput = document.getElementById('mfaCode');
const errorBox = document.getElementById('error-box');
const errorText = document.getElementById('error-text');

// Check if MFA is required on load
async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/status');
    if (res.ok) {
      const status = await res.json();
      if (status.authEnabled && status.mfaEnabled) {
        mfaGroup.style.display = 'flex';
        mfaCodeInput.setAttribute('required', 'true');
      }
    }
  } catch (err) {
    console.error('Failed to get auth status:', err);
  }
}

checkAuthStatus();

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.style.display = 'none';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const mfaCode = mfaCodeInput.value.trim();

  const payload = { username, password };
  if (mfaGroup.style.display === 'flex') {
    payload.mfaCode = mfaCode;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      window.location.href = '/';
    } else {
      const err = await res.json();
      errorText.textContent = err.error || 'Login failed';
      errorBox.style.display = 'flex';
    }
  } catch (err) {
    console.error('Error logging in:', err);
    errorText.textContent = 'Network error. Please try again.';
    errorBox.style.display = 'flex';
  }
});
