export let state = {
    user: null,
    children: [],
    activeChildId: null,
    medicines: [],
    logs: [], 
    issues: [],
    medicineMaster: [],
    profile: null,
    settings: { darkMode: false, sound: false }
};

export let notifiedMeds = {}; 

export function saveSettings() {
    localStorage.setItem('babyMedTrackerSettings', JSON.stringify(state.settings));
}
