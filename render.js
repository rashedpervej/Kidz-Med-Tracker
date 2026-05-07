import { state } from './state.js';
import { getYYYYMMDD, formatTimeFriendly, openModal, renderIssues, formatDateDisplay, calculateAge } from './ui.js';

export function renderAllViews() {
    renderHeader();
    renderHome();
    renderMeds();
    renderHistory();
    renderIssuesPage();
    renderProfile();
    
    if (document.getElementById('view-history').classList.contains('active')) {
        const isStatsActive = document.getElementById('tab-history-stats').classList.contains('btn-primary');
        if (isStatsActive) renderAnalytics();
        else renderHistory();
    }
}

export function renderProfile() {
    const container = document.getElementById('profile-container');
    if (!container) return;
    
    if (!state.user || !state.profile) {
        container.innerHTML = '<p>Loading profile...</p>';
        return;
    }
    
    container.innerHTML = `
        <div class="card" style="margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                <div style="width: 50px; height: 50px; background: var(--primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold;">
                    ${(state.profile.name || 'U')[0].toUpperCase()}
                </div>
                <div>
                    <h3 style="margin: 0; font-size: 18px;">${state.profile.name || 'User'}</h3>
                    <p style="margin: 0; font-size: 14px; color: var(--text-muted);">${state.user.email}</p>
                </div>
            </div>
            <button class="btn btn-outline btn-small" style="width: 100%;" onclick="openProfileModal()">Update Profile</button>
        </div>
    `;
}

export function getDetailedAge(dobString) {
    const dob = new Date(dobString);
    const now = new Date();
    
    let years = now.getFullYear() - dob.getFullYear();
    let months = now.getMonth() - dob.getMonth();
    let days = now.getDate() - dob.getDate();

    if (days < 0) {
        months--;
        const lastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        days += lastMonth.getDate();
    }
    if (months < 0) {
        years--;
        months += 12;
    }

    if (years > 0) {
        return { 
            main: years, 
            unit: years === 1 ? 'Year' : 'Years', 
            sub: months > 0 ? `${months} Month${months > 1 ? 's' : ''}` : '' 
        };
    }
    if (months > 0) {
        return { 
            main: months, 
            unit: months === 1 ? 'Month' : 'Months', 
            sub: days > 0 ? `${days} Day${days > 1 ? 's' : ''}` : '' 
        };
    }
    return { 
        main: days, 
        unit: days === 1 ? 'Day' : 'Days', 
        sub: '' 
    };
}

export function renderHome() {
    const profileContainer = document.getElementById('child-profile-card-container');
    const container = document.getElementById('timeline-container');
    const summary = document.getElementById('home-summary');
    
    if (profileContainer) profileContainer.innerHTML = '';
    container.innerHTML = '';
    summary.innerHTML = '';

    if (!state.activeChildId) {
        if (profileContainer) profileContainer.innerHTML = '<div class="card" style="text-align:center; color:var(--text-muted)">Please add a child profile.</div>';
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted)">Please add a child profile.</p>';
        return;
    }

    const activeChild = state.children.find(c => c.id.toString() === state.activeChildId.toString());
    if (activeChild && profileContainer) {
        const initials = activeChild.name ? activeChild.name[0].toUpperCase() : '?';
        const ageObj = activeChild.dob ? getDetailedAge(activeChild.dob) : { main: 'N/A', unit: '', sub: '' };
        
        profileContainer.innerHTML = `
            <div class="child-profile-card">
                <div class="card-header-row">
                    <div class="child-identity">
                        <div class="child-avatar-large">${initials}</div>
                        <div class="child-name-meta">
                            <h2 class="child-name">${activeChild.name}</h2>
                            <span class="child-meta">Baby ${activeChild.gender || 'Girl'}</span>
                        </div>
                    </div>
                </div>

                <div class="child-profile-stats">
                    <div class="age-display">
                        <div class="age-main-box">
                            <span class="age-val">${ageObj.main}</span>
                        </div>
                        <div class="age-text-group">
                            <span class="age-unit-label">${ageObj.unit}</span>
                            <span class="age-sub-label">${ageObj.sub}</span>
                        </div>
                    </div>
                    
                    <div class="v-stats-group">
                        <div class="stat-row">
                            <div class="stat-icon-box">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M7 2h10M7 22h10"/></svg>
                            </div>
                            <div class="stat-info">
                                <span class="stat-label-text">Length:</span>
                                <span class="stat-value-text">${activeChild.height ? activeChild.height + ' cm' : '--'}</span>
                            </div>
                        </div>
                        <div class="stat-row">
                            <div class="stat-icon-box">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15c0 3.31 2.69 6 6 6s6-2.69 6-6M12 2v2M8 2h8M12 4v10M9 6h6"/></svg>
                            </div>
                            <div class="stat-info">
                                <span class="stat-label-text">Weight:</span>
                                <span class="stat-value-text">${activeChild.weight ? activeChild.weight + ' kg' : '--'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="child-birth-date">
                    Birth: ${activeChild.dob ? formatDateDisplay(activeChild.dob) : 'N/A'}
                </div>
            </div>
        `;
    }

    const today = getYYYYMMDD(new Date());
    const nowTime = new Date().toTimeString().substring(0,5); // HH:MM

    let schedule = [];
    const activeMeds = state.medicines.filter(m => {
        const isChildMatch = m.child_id.toString() === state.activeChildId.toString();
        const isDateMatch = m.start_date <= today && m.end_date >= today;
        const issue = m.issue_id ? state.issues.find(i => i.id.toString() === m.issue_id.toString()) : null;
        
        // Filter out if issue is deleted
        if (issue && issue.is_deleted) return false;
        
        const isIssueActive = issue ? issue.status === 'active' : true;
        return isChildMatch && isDateMatch && isIssueActive;
    });
    
    activeMeds.forEach(m => {
        m.times.forEach(t => {
            const log = state.logs.find(l => l.medicine_id.toString() === m.id.toString() && l.datetime.startsWith(today) && l.datetime.includes(t));
            let status = 'Pending';
            if (log) status = log.status;
            else if (t < nowTime) status = 'Pending-Overdue'; // Still pending but past time
            
            schedule.push({ ...m, scheduleTime: t, status, logId: log ? log.id : null });
        });
    });

    schedule.sort((a, b) => {
        const getPriority = (item) => {
            if (item.status === 'Pending-Overdue') return 1;
            if (item.status === 'Pending') return 2;
            return 3; // Taken or Missed
        };

        const pA = getPriority(a);
        const pB = getPriority(b);

        if (pA !== pB) return pA - pB;
        
        // If same priority, sort by time
        return a.scheduleTime.localeCompare(b.scheduleTime);
    });

    let taken = 0, missed = 0;

    if(schedule.length === 0) {
        container.innerHTML = `<div class="card" style="text-align:center; color:var(--text-muted)">No medicines scheduled for today.</div>`;
    }

    schedule.forEach(item => {
        if(item.status === 'Taken') taken++;
        if(item.status === 'Missed') missed++;

        const div = document.createElement('div');
        let statusClass = 'status-pending';
        if(item.status === 'Taken') statusClass = 'status-taken';
        else if(item.status === 'Missed') statusClass = 'status-missed';
        else if(item.status === 'Pending-Overdue') statusClass = 'status-missed'; // Visual red border for overdue

        div.className = `timeline-item ${statusClass}`;
        
        let actionHtml = '';
        if(item.status === 'Taken') {
            actionHtml = `<div class="badge badge-green">✔ Taken</div> <button class="btn btn-outline btn-small" style="margin-left:10px" onclick="window.undoLog('${item.logId}')">Undo</button>`;
        } else if (item.status === 'Missed') {
            actionHtml = `<div class="badge badge-red">✖ Missed</div> <button class="btn btn-outline btn-small" style="margin-left:10px" onclick="window.undoLog('${item.logId}')">Undo</button>`;
        } else {
            actionHtml = `
                <div class="actions">
                    <button class="btn btn-green" onclick="window.markMed('${item.id}', '${item.scheduleTime}', 'Taken')">✔ Taken</button>
                    <button class="btn btn-red" onclick="window.markMed('${item.id}', '${item.scheduleTime}', 'Missed')">✖ Missed</button>
                </div>
            `;
        }

        const issue = item.issue_id ? state.issues.find(i => i.id.toString() === item.issue_id.toString()) : null;
        div.innerHTML = `
            <div class="time-box">${formatTimeFriendly(item.scheduleTime)}</div>
            <div class="med-details" style="flex:1">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h3>${item.name}</h3>
                        ${issue ? `<span style="font-size: 10px; color: var(--primary); font-weight: 600;">${issue.title}</span>` : ''}
                    </div>
                    ${item.status === 'Pending-Overdue' ? '<span class="badge badge-red">Overdue</span>' : ''}
                </div>
                <p>Dosage: ${item.dosage}</p>
                ${actionHtml}
            </div>
        `;
        container.appendChild(div);
    });

    summary.innerHTML = `
        <div class="summary-card"><h4 style="color:var(--primary)">${schedule.length}</h4><p style="font-size:12px">Total</p></div>
        <div class="summary-card"><h4 style="color:var(--green)">${taken}</h4><p style="font-size:12px">Taken</p></div>
        <div class="summary-card"><h4 style="color:var(--red)">${missed}</h4><p style="font-size:12px">Missed</p></div>
    `;
}

export function renderMeds() {
    const container = document.getElementById('meds-list-container');
    const filterSelect = document.getElementById('med-filter-issue');
    const childHeader = document.getElementById('meds-child-header');
    
    if (childHeader) renderCompactChildHeader(childHeader);

    const selectedIssue = filterSelect.value;
    
    // Populate filter dropdown with active issues
    const activeIssues = state.issues.filter(i => 
        i.child_id.toString() === state.activeChildId.toString() && 
        i.status === 'active' &&
        !i.is_deleted
    );
    
    // Reset options but keep "All Issues"
    filterSelect.innerHTML = '<option value="all">All Issues</option>';
    
    activeIssues.forEach(i => {
        const opt = document.createElement('option');
        opt.value = i.id;
        opt.textContent = i.title;
        filterSelect.appendChild(opt);
    });

    // Restore selection if it still exists
    if (selectedIssue && Array.from(filterSelect.options).some(o => o.value === selectedIssue)) {
        filterSelect.value = selectedIssue;
    }

    container.innerHTML = '';
    if(!state.activeChildId) return;

    let meds = state.medicines.filter(m => {
        const isChildMatch = m.child_id.toString() === state.activeChildId.toString();
        const issue = m.issue_id ? state.issues.find(i => i.id.toString() === m.issue_id.toString()) : null;
        
        // Filter out if issue is deleted
        if (issue && issue.is_deleted) return false;
        
        const isIssueActive = issue ? issue.status === 'active' : true; // If no issue linked, assume active or handle as per requirement
        return isChildMatch && isIssueActive;
    });
    
    if (selectedIssue !== 'all') {
        meds = meds.filter(m => m.issue_id && m.issue_id.toString() === selectedIssue.toString());
    }

    if(meds.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted)">No medicines found for this filter.</p>';
    }

    meds.forEach(m => {
        const issue = m.issue_id ? state.issues.find(i => i.id.toString() === m.issue_id.toString()) : null;
        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between">
                <div>
                    <h3 style="color:var(--primary)">${m.name}</h3>
                    ${issue ? `<span class="badge badge-outline" style="font-size:10px; padding: 2px 8px; border: 1px solid var(--primary); color: var(--primary); margin-top: 5px; display: inline-block;">${issue.title}</span>` : ''}
                </div>
                <div>
                    <button class="btn btn-outline btn-small" onclick="window.openMedModal('${m.id}')">✎</button>
                    <button class="btn btn-red btn-small" onclick="window.deleteMed('${m.id}')">🗑</button>
                </div>
            </div>
            <p style="font-size:13px; color:var(--text-muted); margin-top:10px;">Dosage: ${m.dosage}</p>
            <p style="font-size:13px; color:var(--text-muted)">Dates: ${formatDateDisplay(m.start_date)} to ${formatDateDisplay(m.end_date)}</p>
            <div style="margin-top:10px;">
                ${m.times.map(t => `<span class="badge badge-yellow" style="background:var(--secondary); color:white; margin-right:5px;">${formatTimeFriendly(t)}</span>`).join('')}
            </div>
        `;
        container.appendChild(div);
    });
}

export function renderHistory() {
    const container = document.getElementById('history-list-container');
    const filterInput = document.getElementById('history-date-filter');
    const childHeader = document.getElementById('history-child-header');
    
    if (childHeader) renderCompactChildHeader(childHeader);

    let filterDate = filterInput.value;

    if(!filterDate) {
        filterDate = getYYYYMMDD(new Date());
        filterInput.value = filterDate;
    }

    container.innerHTML = '';
    if(!state.activeChildId) return;

    let logs = state.logs.filter(l => l.child_id.toString() === state.activeChildId.toString() && l.datetime.startsWith(filterDate));
    
    if(logs.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">No records for this date.</p>';
        return;
    }

    // Group logs by issue
    const grouped = {};
    logs.forEach(log => {
        const issueId = log.issue_id || 'none';
        if (!grouped[issueId]) grouped[issueId] = [];
        grouped[issueId].push(log);
    });

    Object.keys(grouped).forEach(issueId => {
        const issue = issueId === 'none' ? { title: 'General / No Issue' } : state.issues.find(i => i.id.toString() === issueId.toString());
        
        // Skip if issue is deleted
        if (issue && issue.is_deleted) return;
        
        const issueLogs = grouped[issueId].sort((a, b) => b.datetime.localeCompare(a.datetime));
        
        const issueSection = document.createElement('div');
        issueSection.style.marginBottom = '20px';
        issueSection.innerHTML = `
            <h4 style="font-size: 14px; color: var(--primary); margin-bottom: 10px; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 5px;">
                ${issue ? issue.title : 'Deleted Issue'}
            </h4>
        `;
        
        issueLogs.forEach(l => {
            const m = state.medicines.find(x => x.id.toString() === l.medicine_id.toString()) || {name: 'Deleted Medicine'};
            const time = l.datetime.split('T')[1].substring(0, 5);
            const div = document.createElement('div');
            div.className = 'card';
            div.style.padding = '15px';
            div.style.marginBottom = '10px';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong>${m.name}</strong> <span style="font-size:12px; color:var(--text-muted); margin-left:10px;">${formatTimeFriendly(time)}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="badge ${l.status === 'Taken' ? 'badge-green' : 'badge-red'}">${l.status}</div>
                        <button class="btn btn-red btn-small" onclick="window.undoLog('${l.id}')" style="padding: 4px 8px;">Undo</button>
                    </div>
                </div>
            `;
            issueSection.appendChild(div);
        });
        container.appendChild(issueSection);
    });
}

export function renderAnalytics() {
    const container = document.getElementById('chart-container');
    container.innerHTML = '';
    if(!state.activeChildId) return;

    // Generate last 7 days array
    let days = [];
    for(let i=6; i>=0; i--) {
        let d = new Date();
        d.setDate(d.getDate() - i);
        days.push(getYYYYMMDD(d));
    }

    let maxTotal = 0;
    let chartData = days.map(day => {
        let taken = 0, missed = 0;
        state.logs.filter(l => l.child_id === state.activeChildId && l.datetime.startsWith(day)).forEach(l => {
            const issue = l.issue_id ? state.issues.find(i => i.id.toString() === l.issue_id.toString()) : null;
            if (issue && issue.is_deleted) return;
            
            if(l.status === 'Taken') taken++;
            if(l.status === 'Missed') missed++;
        });
        let total = taken + missed;
        if(total > maxTotal) maxTotal = total;
        return { day: formatDateDisplay(day), taken, missed, total };
    });

    // Ensure maxTotal is at least 1 for percentage calculation
    if(maxTotal === 0) maxTotal = 1;

    chartData.forEach(data => {
        let takenH = (data.taken / maxTotal) * 100;
        let missedH = (data.missed / maxTotal) * 100;
        if(data.total === 0) { takenH=0; missedH=0; } // flat empty bar

        const wrapper = document.createElement('div');
        wrapper.className = 'bar-wrapper';
        wrapper.innerHTML = `
            <div style="width:100%; display:flex; flex-direction:column; justify-content:flex-end; height:100%;">
                <div class="bar bar-missed" style="height:${missedH}%"></div>
                <div class="bar bar-taken" style="height:${takenH}%"></div>
            </div>
            <div class="bar-label">${data.day}</div>
        `;
        container.appendChild(wrapper);
    });
}

export function renderManageChildren() {
    const container = document.getElementById('child-list-manage');
    if (!container) return;
    container.innerHTML = '';
    state.children.forEach(c => {
        const ageStr = c.dob ? calculateAge(c.dob) : (c.age || 'N/A');
        const div = document.createElement('div');
        div.className = 'child-list-item';
        div.style.display = 'flex'; 
        div.style.justifyContent = 'space-between'; 
        div.style.alignItems = 'center';
        div.style.padding = '12px';
        div.style.borderRadius = '12px';
        div.style.marginBottom = '8px';
        div.style.cursor = 'pointer';
        div.style.background = c.id.toString() === state.activeChildId?.toString() ? 'rgba(var(--primary-rgb), 0.1)' : 'transparent';
        div.style.border = c.id.toString() === state.activeChildId?.toString() ? '1px solid var(--primary)' : '1px solid rgba(0,0,0,0.05)';
        
        div.innerHTML = `
            <div style="flex: 1;" onclick="window.changeChild('${c.id}'); window.closeModal('modal-child')">
                <div style="font-weight: 600; color: ${c.id.toString() === state.activeChildId?.toString() ? 'var(--primary)' : 'inherit'}">${c.name} ${c.id.toString() === state.activeChildId?.toString() ? '✓' : ''}</div>
                <div style="font-size: 11px; color: var(--text-muted);">${ageStr} ${c.dob ? `(${formatDateDisplay(c.dob)})` : ''}</div>
            </div>
            <div style="display: flex; gap: 5px;">
                <button class="btn btn-outline btn-small" onclick="event.stopPropagation(); window.openChildModal('${c.id}')">✎</button>
                <button class="btn btn-red btn-small" onclick="event.stopPropagation(); window.deleteChild('${c.id}')">🗑</button>
            </div>
        `;
        container.appendChild(div);
    });
}

export function renderIssuesPage() {
    const childHeader = document.getElementById('issues-child-header');
    if (childHeader) renderCompactChildHeader(childHeader);
    renderIssues(); // Call the one from ui.js
}

export function renderCompactChildHeader(container) {
    if (!state.activeChildId) {
        container.style.display = 'none';
        return;
    }
    
    const activeChild = state.children.find(c => c.id.toString() === state.activeChildId.toString());
    if (!activeChild) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    
    container.innerHTML = `
        <div class="compact-child-info">
            <span class="compact-app-title">Medz Diary</span>
        </div>
        <div class="compact-child-name-right" onclick="window.openChildModal()">
            ${activeChild.name}
        </div>
    `;
}

export function renderHeader() {
    const parentGreeting = document.getElementById('parent-greeting');
    const greetingText = document.getElementById('greeting-text');
    const profileName = document.getElementById('parent-name-display');
    const parentAvatar = document.getElementById('parent-avatar');
    const headerChildIndicator = document.getElementById('header-child-indicator');
    const headerChildName = document.getElementById('header-child-name');

    if (state.profile) {
        if (profileName) profileName.textContent = state.profile.name || 'User';
        if (parentAvatar) parentAvatar.textContent = (state.profile.name || 'U')[0].toUpperCase();
    }

    const isHome = document.getElementById('view-home').classList.contains('active');
    
    const header = document.querySelector('header');
    if (isHome) {
        if (header) header.style.display = 'flex';
        if (parentGreeting) parentGreeting.style.display = 'flex';
        if (headerChildIndicator) headerChildIndicator.style.display = 'none';
        
        // Update greeting based on time
        if (greetingText) {
            const hour = new Date().getHours();
            if (hour < 12) greetingText.innerText = "Good Morning";
            else if (hour < 17) greetingText.innerText = "Good Afternoon";
            else greetingText.innerText = "Good Evening";
        }
    } else {
        if (header) header.style.display = 'none';
        if (parentGreeting) parentGreeting.style.display = 'none';
        if (headerChildIndicator) headerChildIndicator.style.display = 'none'; // Always hide header child name
    }
}

// --- GLOBAL EXPOSURE ---
window.renderAllViews = renderAllViews;
window.renderHome = renderHome;
window.renderMeds = renderMeds;
window.renderHistory = renderHistory;
window.renderAnalytics = renderAnalytics;
window.renderManageChildren = renderManageChildren;
window.renderHeader = renderHeader;
window.renderCompactChildHeader = renderCompactChildHeader;
