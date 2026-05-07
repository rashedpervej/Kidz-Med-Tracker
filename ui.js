import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { state, saveSettings } from './state.js';
import { signUp, signIn, signOut, resetPassword, updatePassword, reauthenticate, supabaseClient } from './supabase.js';

// --- AUTH UI ---
export async function handleSignUp() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const btn = document.getElementById('auth-submit-btn');
    if (!email || !password) return customAlert("Email and password are required");
    if (password.length < 6) return customAlert("Password must be at least 6 characters long");

    const complexityError = validatePasswordComplexity(password);
    if (complexityError) {
        return customAlert(complexityError);
    }

    if (btn.disabled) return; // Extra safety

    showLoading(true);
    btn.disabled = true;
    try {
        const { data, error } = await signUp(email, password);
        if (error) throw error;
        customAlert("Account created! Please check your email for a confirmation link before logging in.", "Signup Success");
    } catch (err) {
        console.error("Signup Error:", err);
        let msg = (typeof err === 'string' ? err : err.message) || "An error occurred during signup.";
        if (msg.toLowerCase().includes("rate limit exceeded")) {
            msg = "Too many signup attempts. The server has temporarily blocked requests from your IP. Please wait 5 minutes.";
            // Add a 5-minute cooldown timer to the button
            let cooldown = 300; // 300 seconds (5 minutes)
            btn.disabled = true;
            const originalText = btn.innerText;
            const timer = setInterval(() => {
                cooldown--;
                const mins = Math.floor(cooldown / 60);
                const secs = cooldown % 60;
                btn.innerText = `Wait ${mins}:${secs.toString().padStart(2, '0')}...`;
                if (cooldown <= 0) {
                    clearInterval(timer);
                    btn.disabled = false;
                    btn.innerText = originalText;
                }
            }, 1000);
        } else if (msg.toLowerCase().includes("user already registered")) {
            msg = "This email is already registered. Try logging in instead.";
        }
        customAlert(msg, "Signup Error");
    } finally {
        showLoading(false);
        // Only re-enable if not in cooldown
        if (!btn.innerText.includes("Wait")) {
            btn.disabled = false;
        }
    }
}

export async function handleSignIn() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();
    const btn = document.getElementById('auth-submit-btn');
    if (!email || !password) return customAlert("Email and password are required");

    if (btn.disabled) return; // Extra safety

    showLoading(true);
    btn.disabled = true;
    try {
        const { data, error } = await signIn(email, password);
        if (error) throw error;
    } catch (err) {
        console.error("Login Error:", err);
        let msg = (typeof err === 'string' ? err : err.message) || "An error occurred during login.";
        if (msg.toLowerCase().includes("invalid login credentials")) {
            msg = "Incorrect email or password. Please try again.";
            document.getElementById('auth-password').value = ''; // Clear password on failure
        } else if (msg.toLowerCase().includes("email not confirmed")) {
            msg = "Please confirm your email address before logging in. Check your inbox for a link.";
        } else if (msg.toLowerCase().includes("rate limit exceeded")) {
            msg = "Too many login attempts. Please wait 2 minutes and try again.";
            // Add a 2-minute cooldown timer to the button
            let cooldown = 120; 
            btn.disabled = true;
            const originalText = btn.innerText;
            const timer = setInterval(() => {
                cooldown--;
                const mins = Math.floor(cooldown / 60);
                const secs = cooldown % 60;
                btn.innerText = `Wait ${mins}:${secs.toString().padStart(2, '0')}...`;
                if (cooldown <= 0) {
                    clearInterval(timer);
                    btn.disabled = false;
                    btn.innerText = originalText;
                }
            }, 1000);
        }
        customAlert(msg, "Login Error");
    } finally {
        showLoading(false);
        // Only re-enable if not in cooldown
        if (!btn.innerText.includes("Wait")) {
            btn.disabled = false;
        }
    }
}

export async function handleForgotPassword() {
    const email = document.getElementById('auth-email').value.trim();
    const link = document.getElementById('auth-forgot-link');
    if (!email) return customAlert("Please enter your email address first.");
    if (link.style.pointerEvents === 'none') return;

    showLoading(true);
    try {
        const { error } = await resetPassword(email);
        if (error) throw error;
        customAlert("Password reset link sent! Check your inbox.", "Success");
    } catch (err) {
        console.error("Reset Error:", err);
        let msg = (typeof err === 'string' ? err : err.message) || "Could not send reset link.";
        
        // Handle Supabase rate limit error
        if (msg.toLowerCase().includes("security purposes")) {
            // Extract seconds from message if possible
            const match = msg.match(/(\d+)\s+seconds/);
            let cooldown = match ? parseInt(match[1]) : 60;
            
            msg = `Too many requests. Please wait ${cooldown} seconds before trying again.`;
            
            // Disable the link and show a timer
            link.style.pointerEvents = 'none';
            link.style.opacity = '0.5';
            const originalText = link.innerText;
            
            const timer = setInterval(() => {
                cooldown--;
                link.innerText = `Retry in ${cooldown}s`;
                if (cooldown <= 0) {
                    clearInterval(timer);
                    link.style.pointerEvents = 'auto';
                    link.style.opacity = '1';
                    link.innerText = originalText;
                }
            }, 1000);
        }
        
        customAlert(msg, "Reset Error");
    } finally {
        showLoading(false);
    }
}

function validatePasswordComplexity(password) {
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    
    if (!hasLower || !hasUpper || !hasDigit) {
        return "Password must contain at least one lowercase letter, one uppercase letter, and one digit.";
    }
    return null;
}

export async function handleUpdatePassword() {
    const currentPassword = document.getElementById('profile-current-password').value;
    const newPassword = document.getElementById('profile-new-password').value;
    const confirmPassword = document.getElementById('profile-confirm-password').value;

    if (!currentPassword) {
        return customAlert("Please enter your current password.");
    }

    if (!newPassword || !confirmPassword) {
        return customAlert("Please fill in both new password fields.");
    }

    if (newPassword !== confirmPassword) {
        return customAlert("Passwords do not match.");
    }

    if (newPassword.length < 6) {
        return customAlert("Password must be at least 6 characters long.");
    }

    const complexityError = validatePasswordComplexity(newPassword);
    if (complexityError) {
        return customAlert(complexityError);
    }

    showLoading(true);
    try {
        // Reauthenticate first
        const { error: reauthError } = await reauthenticate(currentPassword);
        if (reauthError) throw reauthError;

        const { error } = await updatePassword(newPassword);
        if (error) throw error;
        
        customAlert("Password updated successfully!", "Success");
        document.getElementById('profile-current-password').value = '';
        document.getElementById('profile-new-password').value = '';
        document.getElementById('profile-confirm-password').value = '';
    } catch (err) {
        console.error("Update Password Error:", err);
        customAlert(err.message || "Failed to update password. Please check your current password.", "Error");
    } finally {
        showLoading(false);
    }
}

export async function handleResetPasswordSubmit() {
    const newPassword = document.getElementById('reset-password-new').value;
    const confirmPassword = document.getElementById('reset-password-confirm').value;

    if (!newPassword || !confirmPassword) {
        return customAlert("Please fill in both password fields.");
    }

    if (newPassword !== confirmPassword) {
        return customAlert("Passwords do not match.");
    }

    if (newPassword.length < 6) {
        return customAlert("Password must be at least 6 characters long.");
    }

    const complexityError = validatePasswordComplexity(newPassword);
    if (complexityError) {
        return customAlert(complexityError);
    }

    showLoading(true);
    try {
        const { error } = await updatePassword(newPassword);
        if (error) throw error;
        
        customAlert("Password has been reset successfully! You can now log in with your new password.", "Success");
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
    } catch (err) {
        console.error("Reset Password Error:", err);
        customAlert(err.message || "Failed to reset password. The link may have expired.", "Error");
    } finally {
        showLoading(false);
    }
}

export function togglePasswordVisibility() {
    const pwdInput = document.getElementById('auth-password');
    const toggleIcon = document.getElementById('toggle-password-visibility');
    if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        toggleIcon.innerText = '🙈';
    } else {
        pwdInput.type = 'password';
        toggleIcon.innerText = '👁️';
    }
}

// Add Enter key support
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const authView = document.getElementById('view-auth');
        if (authView && authView.style.display !== 'none') {
            const btn = document.getElementById('auth-submit-btn');
            if (btn && !btn.disabled) {
                btn.click();
            }
        }
    }
});

export async function handleSignOut() {
    showLoading(true);
    try {
        const { error } = await signOut();
        if (error) throw error;
        location.reload();
    } catch (err) {
        console.error("Logout Error:", err);
        customAlert(err.message || "An error occurred during logout.", "Logout Error");
    } finally {
        showLoading(false);
    }
}

export function showAuthView(show) {
    document.getElementById('view-auth').style.display = show ? 'flex' : 'none';
    document.getElementById('app-container').style.display = show ? 'none' : 'block';
    document.getElementById('view-reset-password').style.display = 'none';
}

export function showResetPasswordView(show) {
    document.getElementById('view-reset-password').style.display = show ? 'flex' : 'none';
    document.getElementById('view-auth').style.display = 'none';
    document.getElementById('app-container').style.display = 'none';
}

export function toggleAuthMode() {
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('auth-submit-btn');
    const toggleLink = document.getElementById('auth-toggle-link');
    const forgotPwd = document.getElementById('forgot-password-container');
    
    if (title.innerText === 'Login') {
        title.innerText = 'Sign Up';
        btn.innerText = 'Create Account';
        btn.onclick = handleSignUp;
        toggleLink.innerText = 'Already have an account? Login';
        forgotPwd.style.display = 'none';
    } else {
        title.innerText = 'Login';
        btn.innerText = 'Login';
        btn.onclick = handleSignIn;
        toggleLink.innerText = "Don't have an account? Sign Up";
        forgotPwd.style.display = 'block';
    }
    
    // Reset button state if not in cooldown
    if (!btn.innerText.includes("Wait")) {
        btn.disabled = false;
    }
}

// --- LOADING OVERLAY ---
export function showLoading(show) {
    document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

// --- CUSTOM DIALOGS ---
export function customAlert(message, title = "Alert") {
    document.getElementById('alert-title').innerText = title;
    document.getElementById('alert-message').innerHTML = message;
    document.getElementById('alert-actions').innerHTML = '<button class="btn btn-primary" onclick="window.closeModal(\'modal-alert\')">OK</button>';
    openModal('modal-alert');
}

export function showIssueRequiredModal() {
    document.getElementById('alert-title').innerText = "Issue Required";
    document.getElementById('alert-message').innerText = "Please create an active Issue first before adding medicine.";
    document.getElementById('alert-actions').innerHTML = `
        <div class="flex-3-1">
            <button class="btn btn-primary btn-3" onclick="window.closeModal('modal-alert'); window.openIssueModal();">+ New Issue</button>
            <button class="btn btn-outline btn-1" onclick="window.closeModal('modal-alert')">OK</button>
        </div>
    `;
    openModal('modal-alert');
}

export function customConfirm(message, onConfirm, title = "Confirm") {
    document.getElementById('alert-title').innerText = title;
    document.getElementById('alert-message').innerText = message;
    document.getElementById('alert-actions').innerHTML = `
        <button class="btn btn-outline" onclick="window.closeModal(\'modal-alert\')">Cancel</button>
        <button class="btn btn-red" id="confirm-btn">Confirm</button>
    `;
    document.getElementById('confirm-btn').onclick = () => {
        closeModal('modal-alert');
        onConfirm();
    };
    openModal('modal-alert');
}

// --- MODAL HANDLING ---
let modalZIndex = 1000;

export function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    modalZIndex++;
    el.style.zIndex = modalZIndex;
    el.classList.add('active');
}
export function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active');
}

// --- NAVIGATION ---
export function switchTab(tabId, el) {
    localStorage.setItem('babyMedTrackerActiveTab', tabId);
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${tabId}`).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if(el) el.classList.add('active');

    window.renderHeader();

    // Context-aware FAB visibility
    const fab = document.getElementById('fab');
    if (tabId === 'home' || tabId === 'meds') {
        fab.style.display = 'flex';
    } else {
        fab.style.display = 'none';
    }

    if(tabId === 'history') {
        const activeSubTab = document.getElementById('tab-history-stats').classList.contains('btn-primary') ? 'stats' : 'logs';
        if(activeSubTab === 'stats') window.renderAnalytics();
        else window.renderHistory();
    }
}

// --- HISTORY SUB-TABS ---
export function switchHistoryTab(tab) {
    document.getElementById('tab-history-logs').className = tab === 'logs' ? 'btn btn-small btn-primary' : 'btn btn-small btn-outline';
    document.getElementById('tab-history-stats').className = tab === 'stats' ? 'btn btn-small btn-primary' : 'btn btn-small btn-outline';
    
    document.getElementById('section-history-logs').style.display = tab === 'logs' ? 'block' : 'none';
    document.getElementById('section-history-stats').style.display = tab === 'stats' ? 'block' : 'none';
    
    if(tab === 'stats') window.renderAnalytics();
    else window.renderHistory();
}

// --- SETTINGS ---
export function applySettings() {
    document.getElementById('toggle-dark').checked = state.settings.darkMode;
    document.getElementById('toggle-sound').checked = state.settings.sound;
    toggleDarkMode(state.settings.darkMode);
    
    // Banner visibility
    const showBanner = !state.settings.sound || (("Notification" in window) && Notification.permission !== "granted");
    const banner = document.getElementById('banner');
    if (banner) {
        banner.style.display = showBanner ? 'block' : 'none';
    }
}

export function toggleDarkMode(isDark) {
    state.settings.darkMode = isDark;
    if(isDark) document.body.classList.add('dark-mode');
    else document.body.classList.remove('dark-mode');
    saveSettings();
}

export function toggleSound(isSound) {
    state.settings.sound = isSound;
    saveSettings();
    if (isSound) {
        playBeep();
        // Also check notifications if enabling sound
        if ("Notification" in window && Notification.permission !== "granted") {
            Notification.requestPermission();
        }
    }
    // Update banner
    const showBanner = !isSound || (("Notification" in window) && Notification.permission !== "granted");
    const banner = document.getElementById('banner');
    if (banner) banner.style.display = showBanner ? 'block' : 'none';
}

export function exportToPDF() {
    if (!state.activeChildId) return customAlert("No child selected to export data.");
    
    const child = state.children.find(c => c.id.toString() === state.activeChildId.toString());
    if (!child) return customAlert("Child data not found.");

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header
    doc.setFontSize(22);
    doc.setTextColor(40, 40, 40);
    doc.text("Medical Summary Report", 14, 22);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    const exportDate = new Date().toLocaleString();
    doc.text(`Exported on: ${exportDate}`, 14, 30);
    
    // Child Info
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text("Patient Information", 14, 45);
    
    doc.setFontSize(11);
    doc.text(`Name: ${child.name}`, 14, 52);
    const age = calculateAge(child.dob);
    doc.text(`Age: ${age}`, 14, 58);
    if (child.dob) doc.text(`DOB: ${formatDateDisplay(child.dob)}`, 14, 64);
    
    let currentY = 75;

    // Filter active issues
    const activeIssues = state.issues.filter(i => 
        i.child_id.toString() === state.activeChildId.toString() && 
        !i.is_deleted && 
        i.status === 'active'
    );

    if (activeIssues.length === 0) {
        doc.setFontSize(11);
        doc.text("No active medical issues currently recorded.", 14, currentY);
    } else {
        activeIssues.forEach((issue, index) => {
            // Check for page overflow
            if (currentY > 250) {
                doc.addPage();
                currentY = 20;
            }
            
            doc.setFontSize(14);
            doc.setTextColor(19, 99, 223); // Professional blue
            doc.text(`${index + 1}. Issue: ${issue.title}`, 14, currentY);
            currentY += 7;
            
            doc.setFontSize(10);
            doc.setTextColor(60, 60, 60);
            if (issue.description) {
                const descLines = doc.splitTextToSize(`Description: ${issue.description}`, pageWidth - 28);
                doc.text(descLines, 14, currentY);
                currentY += (descLines.length * 5) + 2;
            }

            // Medicines (Just names)
            const issueMeds = state.medicines.filter(m => m.issue_id && m.issue_id.toString() === issue.id.toString());
            if (issueMeds.length > 0) {
                doc.setFontSize(11);
                doc.setTextColor(0, 0, 0);
                doc.text("Medicines Prescribed:", 14, currentY);
                currentY += 6;
                
                doc.setFontSize(10);
                doc.setTextColor(40, 40, 40);
                issueMeds.forEach(m => {
                    doc.text(`• ${m.name}`, 18, currentY);
                    currentY += 5;
                });
                currentY += 4;
            }

            // Meet History
            if (issue.meets && issue.meets.length > 0) {
                doc.setFontSize(11);
                doc.setTextColor(0, 0, 0);
                doc.text("Appointment History:", 14, currentY);
                currentY += 5;

                const tableData = issue.meets.map(meet => {
                    let instructions = "";
                    if (meet.notes && meet.notes.trim()) {
                        instructions = meet.notes.split('\n').filter(l => l.trim()).map(l => `• ${l.trim()}`).join('\n');
                    }
                    return [
                        formatDateDisplay(meet.date),
                        meet.doctor_name || "-",
                        meet.medical_center || "-",
                        instructions
                    ];
                });

                autoTable(doc, {
                    startY: currentY,
                    head: [['Date', 'Doctor', 'Center', 'Instructions']],
                    body: tableData,
                    theme: 'grid',
                    headStyles: { fillColor: [19, 99, 223] },
                    styles: { fontSize: 9, cellPadding: 3 },
                    columnStyles: {
                        3: { cellWidth: 80 }
                    },
                    margin: { left: 14, right: 14 },
                    didDrawPage: (data) => {
                        // Update currentY after table is drawn
                        currentY = data.cursor.y + 15;
                    }
                });
                currentY = (doc).lastAutoTable.finalY + 15;
            } else {
                currentY += 5;
            }
        });
    }

    doc.save(`${child.name.replace(/\s+/g, '_')}_Medical_Report.pdf`);
}

export function enablePermissions() {
    // Always enable sound when user clicks this
    state.settings.sound = true;
    const toggleSound = document.getElementById('toggle-sound');
    if(toggleSound) toggleSound.checked = true;
    saveSettings();
    playBeep(); // Test sound to unlock AudioContext on iOS/Android
    
    // Unlock SpeechSynthesis on iOS/Mobile
    if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance("");
        u.volume = 0;
        window.speechSynthesis.speak(u);
    }

    if ("Notification" in window) {
        Notification.requestPermission().then(perm => {
            console.log("Notification permission:", perm);
            document.getElementById('banner').style.display = 'none';
        }).catch(e => {
            console.error("Notification request failed:", e);
            document.getElementById('banner').style.display = 'none';
        });
    } else {
        document.getElementById('banner').style.display = 'none';
    }
}

let audioCtx = null;

export function playBeep() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        osc.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
        
        setTimeout(() => {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc2 = audioCtx.createOscillator();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1046.50, audioCtx.currentTime); // C6
            osc2.connect(audioCtx.destination);
            osc2.start();
            osc2.stop(audioCtx.currentTime + 0.5);
        }, 300);
    } catch(e) { console.log("AudioContext not supported/allowed", e); }
}

export function playVoice(text) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9; // slightly slower for clarity
        utterance.pitch = 1.1; // slightly higher pitch
        window.speechSynthesis.speak(utterance);
    }
}

// --- UTILS ---
export function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

export function calculateAge(dob) {
    if (!dob) return "N/A";
    const birthDate = new Date(dob);
    const today = new Date();
    
    let years = today.getFullYear() - birthDate.getFullYear();
    let months = today.getMonth() - birthDate.getMonth();
    let days = today.getDate() - birthDate.getDate();

    if (days < 0) {
        months--;
        const lastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
        days += lastMonth.getDate();
    }

    if (months < 0) {
        years--;
        months += 12;
    }

    const parts = [];
    if (years > 0) parts.push(`${years}y`);
    if (months > 0) parts.push(`${months}m`);
    if (days > 0 || parts.length === 0) parts.push(`${days}d`);
    
    return parts.join(' ');
}

export function getYYYYMMDD(dateObj) {
    if (!dateObj || isNaN(new Date(dateObj).getTime())) return "";
    const d = new Date(dateObj);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function formatDateDisplay(isoDate) {
    if (!isoDate) return "";
    const parts = isoDate.split('T')[0].split('-');
    if (parts.length !== 3) return isoDate;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function parseDateInput(displayDate) {
    if (!displayDate) return "";
    const parts = displayDate.split('/');
    if (parts.length !== 3) return displayDate;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

export function formatDateTimeDisplay(isoDateTime) {
    if (!isoDateTime) return "";
    const [datePart, timePart] = isoDateTime.split('T');
    const formattedDate = formatDateDisplay(datePart);
    const formattedTime = timePart ? formatTimeFriendly(timePart.substring(0, 5)) : "";
    return `${formattedDate} ${formattedTime}`;
}

export function formatTimeFriendly(time24) {
    if (!time24) return "";
    let [h, m] = time24.split(':');
    let hours = parseInt(h);
    let ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${m} ${ampm}`;
}

// --- FORM UTILS ---
export function addTimeRow(time = '') {
    const c = document.getElementById('med-times-container');
    const div = document.createElement('div');
    div.className = 'time-row';
    div.style.display = 'flex';
    div.style.gap = '10px';
    div.style.marginBottom = '8px';
    div.innerHTML = `
        <input type="time" class="med-time-input" value="${time}" required style="flex: 1;">
        <button class="btn btn-red btn-small" onclick="this.parentElement.remove()" title="Remove time slot" style="padding: 0 12px;">✕</button>
    `;
    c.appendChild(div);
}

// --- AUTOCOMPLETE ---
export async function handleMedNameInput(val) {
    const list = document.getElementById('med-autocomplete-list');
    list.innerHTML = '';
    if (!val || val.length < 1) return;
    
    try {
        const { data, error } = await supabaseClient
            .from('medicine_master')
            .select('name')
            .ilike('name', `%${val}%`)
            .order('name')
            .limit(50);
            
        if (error) throw error;
        
        if (data && data.length > 0) {
            data.forEach(match => {
                const div = document.createElement('div');
                // Highlight the match
                const regex = new RegExp(`(${val})`, 'gi');
                const highlightedName = match.name.replace(regex, '<strong>$1</strong>');
                div.innerHTML = highlightedName;
                div.onclick = () => {
                    document.getElementById('med-name').value = match.name;
                    list.innerHTML = '';
                };
                list.appendChild(div);
            });
        }
    } catch (err) {
        console.error("Error fetching medicine suggestions:", err);
        // Fallback to local search if database query fails
        const matches = state.medicineMaster.filter(m => m.name.toLowerCase().includes(val.toLowerCase())).slice(0, 50);
        matches.forEach(match => {
            const div = document.createElement('div');
            const regex = new RegExp(`(${val})`, 'gi');
            const highlightedName = match.name.replace(regex, '<strong>$1</strong>');
            div.innerHTML = highlightedName;
            div.onclick = () => {
                document.getElementById('med-name').value = match.name;
                list.innerHTML = '';
            };
            list.appendChild(div);
        });
    }
}

// --- ISSUE MGMT ---
let currentIssueTab = 'active';

export function switchIssueTab(tab) {
    currentIssueTab = tab;
    document.getElementById('tab-issues-active').className = tab === 'active' ? 'btn btn-small btn-primary' : 'btn btn-small btn-outline';
    document.getElementById('tab-issues-resolved').className = tab === 'resolved' ? 'btn btn-small btn-primary' : 'btn btn-small btn-outline';
    renderIssues();
}

export function refreshIssueReuseList() {
    const idField = document.getElementById('issue-id');
    const meetIdField = document.getElementById('issue-meet-id');
    const prevMedsContainer = document.getElementById('previous-meds-container');
    const prevMedsList = document.getElementById('previous-meds-list');
    
    if (idField.value && meetIdField.value === 'new') {
        const allIssueMeds = state.medicines.filter(m => m.issue_id?.toString() === idField.value.toString());
        if (allIssueMeds.length > 0) {
            prevMedsContainer.style.display = 'block';
            // Keep track of currently checked ones
            const checkedIds = Array.from(document.querySelectorAll('.reuse-med-checkbox:checked')).map(cb => cb.value);
            
            prevMedsList.innerHTML = allIssueMeds.map(m => `
                <label style="display: flex; align-items: center; gap: 5px; background: rgba(var(--primary-rgb), 0.05); padding: 5px 10px; border-radius: 20px; font-size: 12px; cursor: pointer;">
                    <input type="checkbox" class="reuse-med-checkbox" value="${m.id}" ${checkedIds.includes(m.id.toString()) || !checkedIds.length ? 'checked' : ''}>
                    ${m.name}
                </label>
            `).join('');
        } else {
            prevMedsContainer.style.display = 'none';
        }
    }
}

window.refreshIssueReuseList = refreshIssueReuseList;

export function openIssueModal(editId = null, isFollowUp = false) {
    if(!state.activeChildId) return customAlert("Please add a child first.");
    
    const title = document.getElementById('issue-modal-title');
    const idField = document.getElementById('issue-id');
    const meetIdField = document.getElementById('issue-meet-id');
    const titleField = document.getElementById('issue-title');
    const descField = document.getElementById('issue-desc');
    const statusField = document.getElementById('issue-status');
    const doctorField = document.getElementById('issue-doctor');
    const centerField = document.getElementById('issue-center');
    const followUpField = document.getElementById('issue-follow-up');
    const meetDateField = document.getElementById('issue-meet-date');
    const followUpDateField = document.getElementById('issue-follow-up-date');
    const imageDataField = document.getElementById('issue-image-data');
    const previewContainer = document.getElementById('issue-image-preview-container');
    const cropperContainer = document.getElementById('cropper-container');
    const fileInput = document.getElementById('issue-image-input');

    // Reset meet-id field
    meetIdField.value = isFollowUp ? 'new' : '';
    meetDateField.value = getYYYYMMDD(new Date());

    // Reset image fields
    fileInput.value = '';
    cropperContainer.style.display = 'none';
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }

    if (editId) {
        const issue = state.issues.find(i => i.id.toString() === editId.toString());
        const isNewMeet = isFollowUp;
        
        title.innerText = isNewMeet ? "Add Doctor Meet" : "Edit Issue";
        idField.value = issue.id;
        titleField.value = issue.title;
        descField.value = issue.description || '';
        statusField.value = issue.status;

        const latestMeet = issue.meets[issue.meets.length - 1];
        if (isNewMeet) {
            doctorField.value = latestMeet.doctor_name || '';
            centerField.value = latestMeet.medical_center || '';
            followUpField.value = "";
            followUpDateField.value = "";
            imageDataField.value = "";
            
            // Show previous medicines checklist
            const prevMedsContainer = document.getElementById('previous-meds-container');
            const prevMedsList = document.getElementById('previous-meds-list');
            const allIssueMeds = state.medicines.filter(m => m.issue_id?.toString() === issue.id.toString());
            
            if (allIssueMeds.length > 0) {
                prevMedsContainer.style.display = 'block';
                prevMedsList.innerHTML = allIssueMeds.map(m => `
                    <label style="display: flex; align-items: center; gap: 5px; background: rgba(var(--primary-rgb), 0.05); padding: 5px 10px; border-radius: 20px; font-size: 12px; cursor: pointer;">
                        <input type="checkbox" class="reuse-med-checkbox" value="${m.id}" checked>
                        ${m.name}
                    </label>
                `).join('');
            } else {
                prevMedsContainer.style.display = 'none';
            }
        } else {
            doctorField.value = latestMeet.doctor_name || '';
            centerField.value = latestMeet.medical_center || '';
            followUpField.value = latestMeet.notes || '';
            meetDateField.value = getYYYYMMDD(latestMeet.date);
            followUpDateField.value = issue.follow_up_date || '';
            imageDataField.value = latestMeet.prescriptions.join('|');
            meetIdField.value = latestMeet.id;
            document.getElementById('previous-meds-container').style.display = 'none';
        }
        
        renderPrescriptionPreviews();
    } else {
        title.innerText = "Add Issue";
        idField.value = "";
        meetIdField.value = "";
        titleField.value = "";
        descField.value = "";
        statusField.value = "active";
        doctorField.value = "";
        centerField.value = "";
        followUpField.value = "";
        followUpDateField.value = "";
        imageDataField.value = "";
        previewContainer.innerHTML = "";
    }
    openModal('modal-issue');
}

export function renderPrescriptionPreviews() {
    const container = document.getElementById('issue-image-preview-container');
    const imageData = document.getElementById('issue-image-data').value;
    const images = imageData ? imageData.split('|') : [];
    
    container.innerHTML = images.map((src, idx) => `
        <div style="position: relative; width: 80px; height: 80px;">
            <img src="${src}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px; cursor: pointer;" onclick="zoomImage(this.src)">
            <button type="button" class="btn-red btn-small" style="position: absolute; top: -5px; right: -5px; border-radius: 50%; width: 20px; height: 20px; padding: 0; display: flex; align-items: center; justify-content: center;" onclick="removeIssueImage(${idx})">✕</button>
        </div>
    `).join('');

    if (images.length > 1) {
        const galleryBtn = document.createElement('button');
        galleryBtn.type = 'button';
        galleryBtn.className = 'btn btn-outline btn-small';
        galleryBtn.style.height = '80px';
        galleryBtn.style.width = '80px';
        galleryBtn.style.fontSize = '10px';
        galleryBtn.innerText = 'View All Gallery';
        galleryBtn.onclick = () => window.openGallery(images);
        container.appendChild(galleryBtn);
    }
}

// --- IMAGE HANDLING ---
let cropper = null;

export function handleIssueImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const cropperImg = document.getElementById('cropper-image');
        cropperImg.src = e.target.result;
        document.getElementById('cropper-container').style.display = 'block';
        
        if (cropper) cropper.destroy();
        cropper = new Cropper(cropperImg, {
            aspectRatio: NaN, // Free aspect ratio
            viewMode: 1,
        });
    };
    reader.readAsDataURL(file);
}

export function cropAndUpload() {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({
        maxWidth: 1024,
        maxHeight: 1024,
    });
    const base64 = canvas.toDataURL('image/jpeg', 0.7);
    
    const imageDataField = document.getElementById('issue-image-data');
    const currentImages = imageDataField.value ? imageDataField.value.split('|') : [];
    currentImages.push(base64);
    imageDataField.value = currentImages.join('|');
    
    renderPrescriptionPreviews();
    document.getElementById('cropper-container').style.display = 'none';
    cropper.destroy();
    cropper = null;
}

export function cancelCrop() {
    document.getElementById('cropper-container').style.display = 'none';
    document.getElementById('issue-image-input').value = '';
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }
}

export function removeIssueImage(index) {
    const imageDataField = document.getElementById('issue-image-data');
    const currentImages = imageDataField.value ? imageDataField.value.split('|') : [];
    currentImages.splice(index, 1);
    imageDataField.value = currentImages.join('|');
    renderPrescriptionPreviews();
}

export function zoomImage(src) {
    document.getElementById('zoom-img').src = src;
    openModal('modal-zoom');
}

window.handleIssueImageSelect = handleIssueImageSelect;
window.cropAndUpload = cropAndUpload;
window.cancelCrop = cancelCrop;
window.removeIssueImage = removeIssueImage;
window.zoomImage = zoomImage;

let galleryImages = [];
let galleryIndex = 0;

export function openGallery(images) {
    if (!images || images.length === 0) return;
    galleryImages = images;
    galleryIndex = 0;
    updateGallery();
    openModal('modal-gallery');
}

export function updateGallery() {
    const img = document.getElementById('gallery-img');
    const counter = document.getElementById('gallery-counter');
    img.src = galleryImages[galleryIndex];
    counter.innerText = `${galleryIndex + 1} / ${galleryImages.length}`;
}

export function galleryNext() {
    galleryIndex = (galleryIndex + 1) % galleryImages.length;
    updateGallery();
}

export function galleryPrev() {
    galleryIndex = (galleryIndex - 1 + galleryImages.length) % galleryImages.length;
    updateGallery();
}

document.getElementById('gallery-next').onclick = galleryNext;
document.getElementById('gallery-prev').onclick = galleryPrev;

window.openGallery = openGallery;

export function openTrashModal() {
    renderTrash();
    openModal('modal-trash');
}

window.openTrashModal = openTrashModal;

export function renderTrash() {
    const container = document.getElementById('trash-list-container');
    if (!container) return;
    
    const deletedIssues = state.issues.filter(i => 
        i.child_id.toString() === state.activeChildId?.toString() && 
        i.is_deleted === true
    );

    if (deletedIssues.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-muted); margin-top: 20px;">Trash is empty.</p>`;
        return;
    }

    container.innerHTML = deletedIssues.map(issue => `
        <div class="card" style="padding: 15px; margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="flex: 1;">
                    <h3 style="font-size: 16px;">${issue.title}</h3>
                    <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Deleted from: ${issue.status.toUpperCase()}</p>
                </div>
                <div style="display: flex; gap: 5px; margin-left: 10px;">
                    <button class="btn btn-green btn-small" onclick="window.restoreIssue('${issue.id}')" title="Restore">↺</button>
                    <button class="btn btn-red btn-small" onclick="window.permanentlyDeleteIssue('${issue.id}')" title="Delete Permanently">🗑</button>
                </div>
            </div>
        </div>
    `).join('');
}

window.renderTrash = renderTrash;

export function renderIssues() {
    const container = document.getElementById('issues-list-container');
    if (!container) return;
    
    // Refresh compact header if it exists
    const childHeader = document.getElementById('issues-child-header');
    if (childHeader && window.renderCompactChildHeader) window.renderCompactChildHeader(childHeader);

    const filtered = state.issues.filter(i => 
        i.child_id.toString() === state.activeChildId?.toString() && 
        i.status === currentIssueTab &&
        !i.is_deleted
    );

    if (filtered.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-muted); margin-top: 20px;">No ${currentIssueTab} issues found.</p>`;
        return;
    }

    container.innerHTML = filtered.map(issue => {
        const medCount = state.medicines.filter(m => m.issue_id?.toString() === issue.id.toString()).length;
        const isNearFollowUp = issue.follow_up_date && (new Date(issue.follow_up_date) - new Date()) < (3 * 24 * 60 * 60 * 1000) && (new Date(issue.follow_up_date) - new Date()) > - (24 * 60 * 60 * 1000);

        return `
            <div class="card ${isNearFollowUp ? 'near-follow-up' : ''}" style="padding: 15px; position: relative;">
                ${isNearFollowUp ? '<div style="position: absolute; top: -5px; right: -5px; background: var(--red); color: white; font-size: 10px; padding: 2px 6px; border-radius: 10px; font-weight: bold; animation: pulse 2s infinite;">Follow-up Near</div>' : ''}
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="flex: 1;">
                        <h3 style="font-size: 16px;">${issue.title}</h3>
                        ${issue.doctor_name || issue.medical_center ? `
                            <p style="font-size: 11px; color: var(--primary); margin-top: 2px;">
                                ${issue.doctor_name ? `Dr. ${issue.doctor_name}` : ''} 
                                ${issue.doctor_name && issue.medical_center ? ' @ ' : ''} 
                                ${issue.medical_center || ''}
                            </p>
                        ` : ''}
                        ${issue.follow_up_date ? `
                            <p style="font-size: 11px; ${isNearFollowUp ? 'color: var(--red); font-weight: bold;' : 'color: var(--primary);'} margin-top: 4px;">
                                🗓️ Follow-up: ${formatDateDisplay(issue.follow_up_date)}
                            </p>
                        ` : ''}
                        <p style="font-size: 12px; color: var(--text-muted); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${issue.description || 'No description'}</p>
                        <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
                            <div class="badge ${issue.status === 'active' ? 'badge-green' : 'badge-yellow'}">
                                ${issue.status.toUpperCase()}
                            </div>
                            <span style="font-size: 11px; color: var(--text-muted);">${medCount} Meds</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 5px; margin-left: 10px;">
                        <button class="btn btn-outline btn-small" onclick="openIssueModal('${issue.id}')">✎</button>
                        <button class="btn btn-red btn-small" onclick="deleteIssue('${issue.id}')">🗑</button>
                    </div>
                </div>
                <div style="margin-top: 15px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 10px;">
                    <button class="btn btn-primary btn-small" style="width: 100%;" onclick="showIssueDetails('${issue.id}')">View Details & History</button>
                </div>
            </div>
        `;
    }).join('');
}

export function showIssueDetails(issueId) {
    const issue = state.issues.find(i => i.id.toString() === issueId.toString());
    const meds = state.medicines.filter(m => m.issue_id?.toString() === issueId.toString());
    const logs = state.logs.filter(l => l.issue_id?.toString() === issueId.toString()).sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

    const isNearFollowUp = issue.follow_up_date && (new Date(issue.follow_up_date) - new Date()) < (3 * 24 * 60 * 60 * 1000) && (new Date(issue.follow_up_date) - new Date()) > - (24 * 60 * 60 * 1000);

    const latestMeet = issue.meets.length > 0 ? issue.meets[issue.meets.length - 1] : null;

    let content = `
        <div style="text-align: left;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <h2 style="font-size: 20px; margin: 0;">${issue.title}</h2>
                <div class="badge ${issue.status === 'active' ? 'badge-green' : 'badge-yellow'}">${issue.status.toUpperCase()}</div>
            </div>
            
            <div style="background: rgba(var(--primary-rgb), 0.05); padding: 15px; border-radius: 12px; margin-bottom: 20px; border: 1px solid rgba(var(--primary-rgb), 0.1);">
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: ${latestMeet && latestMeet.notes ? '12px' : '0'};">
                    <div style="text-align: center; border-right: 1px solid rgba(var(--primary-rgb), 0.1);">
                        <div style="font-size: 18px; font-weight: bold; color: var(--primary);">${meds.length}</div>
                        <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Total Meds</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 18px; font-weight: bold; color: var(--primary);">${issue.meets.length}</div>
                        <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Doctor Meets</div>
                    </div>
                </div>
                ${latestMeet && latestMeet.notes ? `
                    <div style="padding-top: 12px; border-top: 1px solid rgba(var(--primary-rgb), 0.1);">
                        <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px;">Latest Doctor Instructions</div>
                        <p style="margin: 0; font-size: 12px; line-height: 1.4; color: var(--text-dark);">${latestMeet.notes}</p>
                    </div>
                ` : ''}
            </div>

            <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 15px;">
                <div><strong>Created:</strong> ${formatDateDisplay(issue.created_at)}</div>
                ${issue.resolved_at ? `<div><strong>Resolved:</strong> ${formatDateDisplay(issue.resolved_at)}</div>` : ''}
                ${issue.follow_up_date ? `
                    <div style="margin-top: 5px; padding: 5px 10px; border-radius: 6px; display: inline-block; ${isNearFollowUp ? 'background: var(--red); color: white; font-weight: bold; animation: pulse 2s infinite;' : 'background: rgba(var(--primary-rgb), 0.1); color: var(--primary);'}">
                        <strong>Next Follow-up:</strong> ${formatDateDisplay(issue.follow_up_date)}
                    </div>
                ` : ''}
            </div>

            <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button class="btn btn-primary btn-small" onclick="window.openFollowUpAction('${issue.id}')">+ Doctor Meet</button>
                <button class="btn btn-outline btn-small" onclick="window.openMedModal(null, '${issue.id}')">+ Add Medicine</button>
            </div>

            <h4 style="margin-bottom: 15px; border-bottom: 2px solid var(--primary); padding-bottom: 5px;">Visit History</h4>
            <div style="display: flex; flex-direction: column; gap: 15px; margin-bottom: 25px;">
                ${issue.meets.map((meet, idx) => {
                    const meetMeds = meds.filter(m => (meet.medicine_ids || []).map(id => id.toString()).includes(m.id.toString()));
                    const colors = ['#f0f9ff', '#fdf2f8', '#f0fdf4', '#fffbeb', '#f5f3ff'];
                    const bgColor = colors[idx % colors.length];
                    const borderColor = `rgba(var(--primary-rgb), 0.2)`;

                    return `
                        <div class="card" style="padding: 15px; background: ${bgColor}; border-left: 5px solid var(--primary); border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <span class="badge" style="background: var(--primary); color: white; border-radius: 6px;">${idx + 1}${getOrdinalSuffix(idx + 1)} Meet</span>
                                <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">${formatDateDisplay(meet.date)}</span>
                            </div>
                            
                            <div style="font-size: 13px; margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 10px;">
                                ${meet.doctor_name ? `<div><span style="color: var(--text-muted);">Dr.</span> <strong>${meet.doctor_name}</strong></div>` : ''}
                                ${meet.medical_center ? `<div><span style="color: var(--text-muted);">@</span> <strong>${meet.medical_center}</strong></div>` : ''}
                            </div>

                            ${meet.notes ? `
                                <div style="background: rgba(255,255,255,0.6); padding: 10px; border-radius: 8px; margin-bottom: 12px; font-size: 13px; border: 1px solid rgba(0,0,0,0.03);">
                                    <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Instructions</div>
                                    ${meet.notes}
                                </div>
                            ` : ''}

                            ${meet.prescriptions && meet.prescriptions.length > 0 ? `
                                <div style="margin-bottom: 12px;">
                                    <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px;">Prescriptions</div>
                                    <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                                        ${meet.prescriptions.map(url => `
                                            <img src="${url}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px; cursor: zoom-in; border: 1px solid rgba(0,0,0,0.05);" onclick="window.zoomImage(this.src)">
                                        `).join('')}
                                        <button class="btn btn-outline btn-small" style="height: 60px; padding: 0 10px; border-radius: 8px; font-size: 10px;" onclick="window.openGallery(${JSON.stringify(meet.prescriptions).replace(/"/g, '&quot;')})">View All<br>Gallery</button>
                                    </div>
                                </div>
                            ` : ''}

                            <div style="font-size: 12px;">
                                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px;">Medicines</div>
                                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                                    ${meetMeds.length ? meetMeds.map(m => `
                                        <span class="badge badge-outline" style="font-size: 10px; background: white; border-color: var(--primary); color: var(--primary);">${m.name}</span>
                                    `).join('') : '<span style="color: var(--text-muted);">None</span>'}
                                </div>
                            </div>
                        </div>
                    `;
                }).reverse().join('')}
            </div>

            <h4 style="margin-bottom: 10px; border-bottom: 1px solid var(--primary); display: inline-block; font-size: 14px;">All Linked Medicines</h4>
            <div style="margin-bottom: 15px;">
                ${meds.length ? meds.map(m => `<div style="font-size: 14px; margin-bottom: 5px;">• ${m.name} (${m.dosage})</div>`).join('') : '<p style="font-size: 12px; color: var(--text-muted);">No medicines linked.</p>'}
            </div>
            
            <h4 style="margin-bottom: 10px; border-bottom: 1px solid var(--primary); display: inline-block; font-size: 14px;">Intake History</h4>
            <div style="max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.02); border-radius: 8px; padding: 5px;">
                ${logs.length ? logs.map(l => {
                    const med = state.medicines.find(m => m.id.toString() === l.medicine_id.toString());
                    return `
                        <div style="font-size: 12px; padding: 8px; border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; justify-content: space-between;">
                            <span>${med ? med.name : 'Unknown'} - ${l.status}</span>
                            <span style="color: var(--text-muted);">${formatDateTimeDisplay(l.datetime)}</span>
                        </div>
                    `;
                }).join('') : '<p style="font-size: 12px; color: var(--text-muted); padding: 10px;">No history for this issue.</p>'}
            </div>
            
            <button class="btn btn-outline" style="width: 100%; margin-top: 20px;" onclick="window.closeModal('modal-alert')">Close</button>
        </div>
    `;

    const alertModal = document.getElementById('modal-alert');
    const alertMsg = document.getElementById('alert-message');
    alertMsg.innerHTML = content;
    alertModal.classList.add('active');
}

export function getOrdinalSuffix(i) {
    var j = i % 10, k = i % 100;
    if (j == 1 && k != 11) return "st";
    if (j == 2 && k != 12) return "nd";
    if (j == 3 && k != 13) return "rd";
    return "th";
}

export function openFollowUpAction(issueId) {
    const issue = state.issues.find(i => i.id.toString() === issueId.toString());
    closeModal('modal-alert');
    
    // Open issue modal as a follow-up
    openIssueModal(issueId, true);
}

window.openFollowUpAction = openFollowUpAction;

// --- GLOBAL EXPOSURE (for HTML onclick) ---
window.showLoading = showLoading;
window.customAlert = customAlert;
window.customConfirm = customConfirm;
window.showIssueRequiredModal = showIssueRequiredModal;
window.openModal = openModal;
window.closeModal = closeModal;
window.switchTab = switchTab;
window.toggleDarkMode = toggleDarkMode;
window.toggleSound = toggleSound;
window.exportToPDF = exportToPDF;
window.enablePermissions = enablePermissions;
window.addTimeRow = addTimeRow;
window.handleSignUp = handleSignUp;
window.handleSignIn = handleSignIn;
window.handleSignOut = handleSignOut;
window.toggleAuthMode = toggleAuthMode;
window.handleMedNameInput = handleMedNameInput;
window.switchIssueTab = switchIssueTab;
window.switchHistoryTab = switchHistoryTab;
window.openIssueModal = openIssueModal;
window.showIssueDetails = showIssueDetails;
window.togglePasswordVisibility = togglePasswordVisibility;
window.handleForgotPassword = handleForgotPassword;
window.handleUpdatePassword = handleUpdatePassword;
window.handleResetPasswordSubmit = handleResetPasswordSubmit;
