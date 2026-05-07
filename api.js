import { supabaseClient, uploadImage, deleteImage, getUser } from './supabase.js';
import { state, saveSettings } from './state.js';
import { showLoading, customAlert, customConfirm, closeModal, openModal } from './ui.js';

const generateId = () => Date.now().toString() + Math.random().toString(36).substring(2, 9);

export async function fetchAllData() {
    const user = await getUser();
    if (!user) return;
    const uid = user.id;

    try {
        const [childrenRes, medicinesRes, logsRes, issuesRes, masterRes, profileRes, meetsRes] = await Promise.all([
            supabaseClient.from('children').select('*').eq('user_id', uid),
            supabaseClient.from('medicines').select('*').eq('user_id', uid),
            supabaseClient.from('logs').select('*').eq('user_id', uid),
            supabaseClient.from('issues').select('*').eq('user_id', uid),
            supabaseClient.from('medicine_master').select('*'),
            supabaseClient.from('profiles').select('*').eq('id', uid).single(),
            supabaseClient.from('meets').select('*').eq('user_id', uid).order('date', { ascending: true })
        ]);

        if (childrenRes.error) throw childrenRes.error;
        if (medicinesRes.error) throw medicinesRes.error;
        if (logsRes.error) throw logsRes.error;
        if (issuesRes.error) throw issuesRes.error;
        if (masterRes.error) throw masterRes.error;

        // Handle profile
        if (profileRes.error && profileRes.code !== 'PGRST116') {
            console.error("Error fetching profile:", profileRes.error);
        }
        
        if (!profileRes.data) {
            // Create profile if it doesn't exist
            console.log("Profile not found, creating one...");
            const { data: newProfile, error: createError } = await supabaseClient
                .from('profiles')
                .insert([{ id: uid, name: user.email.split('@')[0], last_selected_child_id: null }])
                .select()
                .single();
            
            if (createError) console.error("Error creating profile:", createError);
            state.profile = newProfile;
        } else {
            state.profile = profileRes.data;
        }

        state.children = childrenRes.data || [];
        const allMeets = meetsRes.data || [];
        state.issues = (issuesRes.data || []).map(i => {
            // Find meets for this issue from the separate table
            const issueMeets = allMeets.filter(m => m.issue_id === i.id).map(m => ({
                id: m.id,
                date: m.date,
                doctor_name: m.doctor || "",
                medical_center: m.center || "",
                notes: m.notes || "",
                prescriptions: m.prescriptions || [],
                medicine_ids: Array.from(new Set([
                    ...(m.medicine_ids || []),
                    ...(medicinesRes.data || []).filter(med => med.meet_id === m.id).map(med => med.id)
                ]))
            }));

            if (issueMeets.length === 0) {
                // Fallback to initial meet data from issue columns if no meets found in meets table
                issueMeets.push({
                    id: 'initial',
                    date: i.created_at || new Date().toISOString(),
                    doctor_name: i.doctor_name || "",
                    medical_center: i.medical_center || "",
                    notes: i.doctor_follow_up || "",
                    prescriptions: i.prescription_url ? [i.prescription_url] : [],
                    medicine_ids: Array.from(new Set([
                        ...(i.medicine_ids || []),
                        ...(medicinesRes.data || []).filter(med => med.issue_id === i.id && !med.meet_id).map(med => med.id)
                    ]))
                });
            }
            
            return {
                ...i,
                is_deleted: !!i.is_deleted,
                meets: issueMeets
            };
        });
        state.medicines = (medicinesRes.data || []).map(m => {
            if (typeof m.times === 'string') {
                try { m.times = JSON.parse(m.times); } catch(e) { m.times = []; }
            }
            if (!Array.isArray(m.times)) m.times = [];
            
            // Link issue status in-memory since join failed
            const issue = m.issue_id ? state.issues.find(i => i.id.toString() === m.issue_id.toString()) : null;
            m.issues = issue ? { status: issue.status } : null;

            // Link medicine to the correct meet if not already linked
            if (issue && issue.meets) {
                // If medicine has a meet_id, use it, otherwise assign to first meet for old data
                const meetId = m.meet_id;
                const meet = meetId ? issue.meets.find(mt => mt.id === meetId) : issue.meets[0];
                if (meet) {
                    if (!meet.medicine_ids) meet.medicine_ids = [];
                    if (!meet.medicine_ids.map(id => id.toString()).includes(m.id.toString())) {
                        meet.medicine_ids.push(m.id);
                    }
                }
            }
            
            return m;
        });
        state.logs = logsRes.data || [];
        state.medicineMaster = masterRes.data || [];
    } catch (err) {
        if (err.message === 'Failed to fetch') {
            console.error("CRITICAL: Supabase endpoint unreachable. This usually means the project is paused or the URL is wrong.");
            customAlert("Could not connect to the database. Please check your internet connection or ensure the Supabase project is active.", "Connection Error");
        } else {
            console.error("Error fetching data:", err.message || err);
        }
        throw err;
    }
}

export async function saveChild() {
    const user = await getUser();
    if (!user) return;
    const uid = user.id;

    const id = document.getElementById('child-id').value;
    const name = document.getElementById('child-name').value.trim();
    const dob = document.getElementById('child-dob').value;
    
    if(!name) return customAlert("Name is required");

    showLoading(true);
    try {
        const childObj = { 
            name, 
            dob: dob || null, 
            user_id: uid 
        };

        let result;
        if (id) {
            result = await supabaseClient.from('children').update(childObj).eq('id', id).eq('user_id', uid).select();
        } else {
            result = await supabaseClient.from('children').insert([childObj]).select();
        }

        if (result.error) throw result.error;

        const savedChild = result.data[0];
        
        if (id) {
            const idx = state.children.findIndex(c => c.id.toString() === id.toString());
            if (idx !== -1) state.children[idx] = savedChild;
        } else {
            state.children.push(savedChild);
            if(!state.activeChildId) {
                state.activeChildId = savedChild.id;
                updateProfileSelectedChild(state.activeChildId);
            }
        }
        
        saveSettings();
        window.renderHeader();
        window.renderManageChildren();
        window.renderAllViews();
        
        // If it was a new child and first one, or if we just edited, we might want to close
        // For now, let's just close if it was an edit or if it's the only child
        if (id || state.children.length === 1) closeModal('modal-child'); 
        
        customAlert(id ? "Child profile updated!" : "Child profile added!");
    } catch (err) {
        console.error("Error saving child:", err.message || err);
        customAlert("Failed to save child profile.");
    } finally {
        showLoading(false);
    }
}

export async function deleteChild(id) {
    customConfirm("Delete this profile and all related data?", async () => {
        const user = await getUser();
        if (!user) return;
        const uid = user.id;

        showLoading(true);
        try {
            const { error } = await supabaseClient.from('children').delete().eq('id', id).eq('user_id', uid);
            if (error) throw error;

            state.children = state.children.filter(c => c.id !== id);
            state.medicines = state.medicines.filter(m => m.child_id !== id);
            state.logs = state.logs.filter(l => l.child_id !== id);
            
            if(state.activeChildId === id) {
                state.activeChildId = state.children.length ? state.children[0].id : null;
                updateProfileSelectedChild(state.activeChildId);
            }
            
            saveSettings();
            window.renderHeader();
            window.renderManageChildren();
            window.renderAllViews();
            if(!state.activeChildId) window.openChildModal();
        } catch (err) {
            console.error("Error deleting child:", err.message || err);
            customAlert("Failed to delete child profile.");
        } finally {
            showLoading(false);
        }
    });
}

export async function saveIssue(silent = false) {
    const user = await getUser();
    if (!user) {
        console.error("Save Issue failed: No authenticated user found.");
        return customAlert("You must be logged in to save issues.");
    }
    const uid = user.id;

    const id = document.getElementById('issue-id').value;
    const title = document.getElementById('issue-title').value.trim();
    const description = document.getElementById('issue-desc').value.trim();
    const status = document.getElementById('issue-status').value;
    const doctor_name = document.getElementById('issue-doctor').value.trim();
    const medical_center = document.getElementById('issue-center').value.trim();
    const doctor_follow_up = document.getElementById('issue-follow-up').value.trim();
    const meetDate = document.getElementById('issue-meet-date')?.value || new Date().toISOString().split('T')[0];
    const follow_up_date = document.getElementById('issue-follow-up-date').value;
    const imageData = document.getElementById('issue-image-data').value;
    const meetId = document.getElementById('issue-meet-id')?.value; // For follow-up creation

    // Collect reused medicine IDs
    const reusedMedIds = [];
    const checkboxes = document.querySelectorAll('.reuse-med-checkbox:checked');
    checkboxes.forEach(cb => reusedMedIds.push(cb.value));

    if (!title) return customAlert("Title is required");
    if (!state.activeChildId) return customAlert("No active child selected.");

    let existingIssue = id ? state.issues.find(i => i.id.toString() === id.toString()) : null;

    // Same date meet logic
    if (meetId === 'new' && existingIssue) {
        const sameDateMeet = existingIssue.meets.find(m => m.date === meetDate);
        if (sameDateMeet && !silent) {
            return customConfirm(`A meet already exists on ${meetDate}. Do you want to update that meet instead?`, () => {
                document.getElementById('issue-meet-id').value = sameDateMeet.id;
                saveIssue();
            });
        }
    }

    showLoading(true);
    try {
        let prescription_url = null;
        let all_prescriptions = [];
        
        // Handle multiple images if present (comma separated base64 or URLs)
        const imageSources = imageData ? imageData.split('|') : [];
        
        for (const src of imageSources) {
            if (src.startsWith('data:image')) {
                console.log("Uploading new prescription image...");
                try {
                    const byteString = atob(src.split(',')[1]);
                    const mimeString = src.split(',')[0].split(':')[1].split(';')[0];
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }
                    const blob = new Blob([ab], { type: mimeString });
                    
                    const fileName = `${uid}/${Date.now()}_${Math.floor(Math.random()*1000)}.jpg`;
                    const url = await uploadImage('prescriptions', fileName, blob);
                    all_prescriptions.push(url);
                    if (!prescription_url) prescription_url = url; // Use first as primary for back-compat
                } catch (uploadErr) {
                    console.error("Image upload failed:", uploadErr);
                }
            } else if (src.startsWith('http')) {
                all_prescriptions.push(src);
                if (!prescription_url) prescription_url = src;
            }
        }

        let meets = [];
        
        if (existingIssue) {
            // Ensure meets is an array even if it was stored as a string
            meets = existingIssue.meets || [];
            if (typeof meets === 'string') {
                try { meets = JSON.parse(meets); } catch(e) { meets = []; }
            }
            meets = JSON.parse(JSON.stringify(meets)); // Deep clone
            
            if (meetId === 'new') {
                // Creating a new follow-up meet
                meets.push({
                    id: generateId(),
                    date: meetDate,
                    doctor_name: doctor_name || "",
                    medical_center: medical_center || "",
                    notes: doctor_follow_up || "",
                    prescriptions: all_prescriptions,
                    medicine_ids: reusedMedIds
                });
            } else {
                // Updating latest meet or specific meet
                const targetMeet = meetId ? meets.find(m => m.id.toString() === meetId.toString()) : meets[meets.length - 1];
                if (targetMeet) {
                    targetMeet.date = meetDate;
                    targetMeet.doctor_name = doctor_name || "";
                    targetMeet.medical_center = medical_center || "";
                    targetMeet.notes = doctor_follow_up || "";
                    targetMeet.prescriptions = all_prescriptions;
                    // medicine_ids are kept
                }
            }
        } else {
            // First meet for new issue
            meets = [{
                id: generateId(),
                date: meetDate,
                doctor_name: doctor_name || "",
                medical_center: medical_center || "",
                notes: doctor_follow_up || "",
                prescriptions: all_prescriptions,
                medicine_ids: reusedMedIds
            }];
        }

        // Construct object carefully to avoid undefined values
        const issueObj = {
            child_id: state.activeChildId,
            title: title,
            description: description || "",
            status: status || "active",
            doctor_name: doctor_name || "",
            medical_center: medical_center || "",
            doctor_follow_up: doctor_follow_up || "",
            follow_up_date: follow_up_date || null,
            prescription_url: prescription_url || null,
            user_id: uid,
            is_deleted: false
        };

        // Handle resolved_at
        if (status === 'resolved') {
            issueObj.resolved_at = new Date().toISOString();
        } else {
            issueObj.resolved_at = null;
        }

        console.log("Saving issue to Supabase:", issueObj);

        let result;
        if (id) {
            result = await supabaseClient.from('issues')
                .update(issueObj)
                .eq('id', id)
                .eq('user_id', uid)
                .select();
        } else {
            issueObj.created_at = new Date().toISOString();
            result = await supabaseClient.from('issues')
                .insert([issueObj])
                .select();
        }

        if (result.error) {
            console.error("Supabase Error Details:", {
                message: result.error.message,
                details: result.error.details,
                hint: result.error.hint,
                code: result.error.code
            });
            throw result.error;
        }

        const savedIssue = result.data[0];
        console.log("Issue saved successfully:", savedIssue);

        // Save meets to the separate table
        let lastSavedMeetId = null;
        for (const meet of meets) {
            const meetObj = {
                issue_id: savedIssue.id,
                date: meet.date,
                doctor: meet.doctor_name,
                center: meet.medical_center,
                notes: meet.notes,
                prescriptions: meet.prescriptions || [],
                medicine_ids: meet.medicine_ids || [],
                user_id: uid
            };

            const isExisting = existingIssue && existingIssue.meets && existingIssue.meets.find(m => m.id.toString() === meet.id.toString() && m.id !== 'initial');

            if (isExisting) {
                const { data: updatedMeet } = await supabaseClient.from('meets').update(meetObj).eq('id', meet.id).eq('user_id', uid).select();
                if (updatedMeet) lastSavedMeetId = updatedMeet[0].id;
            } else {
                // For new meets or initial meet that needs to be persisted
                const { data: newMeet, error: meetError } = await supabaseClient.from('meets').insert([meetObj]).select();
                if (meetError) {
                    console.error("Error inserting meet:", meetError);
                    // Fallback: try without medicine_ids/prescriptions if they don't exist in schema
                    if (meetError.message.includes('column') || meetError.code === '42703') {
                        delete meetObj.medicine_ids;
                        delete meetObj.prescriptions;
                        const { data: retryMeet, error: retryError } = await supabaseClient.from('meets').insert([meetObj]).select();
                        if (retryError) throw retryError;
                        
                        if (retryMeet) lastSavedMeetId = retryMeet[0].id;

                        // If retry succeeded, we still need to link medicines via meet_id
                        if (meet.medicine_ids && meet.medicine_ids.length > 0) {
                            await supabaseClient.from('medicines')
                                .update({ meet_id: retryMeet[0].id })
                                .in('id', meet.medicine_ids);
                        }
                    } else {
                        throw meetError;
                    }
                } else {
                    if (newMeet) lastSavedMeetId = newMeet[0].id;
                    // Update medicines to point to this meet (for backward compatibility and active tracking)
                    if (meet.medicine_ids && meet.medicine_ids.length > 0) {
                        await supabaseClient.from('medicines')
                            .update({ meet_id: newMeet[0].id })
                            .in('id', meet.medicine_ids);
                    }
                }
            }
        }

        // Re-fetch all data to ensure state is consistent with the new table structure
        await fetchAllData();

        if (silent) {
            // If silent, we don't close the modal, we just return the saved issue and meet ID
            return { issue: savedIssue, meetId: lastSavedMeetId };
        }

        closeModal('modal-issue');
        window.renderAllViews();
        customAlert(id ? "Issue updated successfully!" : "New issue created!");
    } catch (err) {
        console.error("Final Error saving issue:", err);
        customAlert(`Error: ${err.message || "Failed to save issue. Check console for details."}`);
    } finally {
        showLoading(false);
    }
}

export async function softDeleteIssue(id) {
    const user = await getUser();
    if (!user) return;
    const uid = user.id;

    showLoading(true);
    try {
        const { error } = await supabaseClient.from('issues')
            .update({ is_deleted: true })
            .eq('id', id)
            .eq('user_id', uid);
        
        if (error) throw error;

        // Update in-memory state
        const issue = state.issues.find(i => i.id.toString() === id.toString());
        if (issue) issue.is_deleted = true;

        window.renderAllViews();
        customAlert("Issue moved to Trash.");
    } catch (err) {
        console.error("Error moving issue to trash:", err.message || err);
        customAlert("Failed to move issue to trash.");
    } finally {
        showLoading(false);
    }
}

export async function restoreIssue(id) {
    const user = await getUser();
    if (!user) return;
    const uid = user.id;

    showLoading(true);
    try {
        const { error } = await supabaseClient.from('issues')
            .update({ is_deleted: false })
            .eq('id', id)
            .eq('user_id', uid);
        
        if (error) throw error;

        // Update in-memory state
        const issue = state.issues.find(i => i.id.toString() === id.toString());
        if (issue) issue.is_deleted = false;

        window.renderAllViews();
        customAlert("Issue restored successfully!");
    } catch (err) {
        console.error("Error restoring issue:", err.message || err);
        customAlert("Failed to restore issue.");
    } finally {
        showLoading(false);
    }
}

export async function permanentlyDeleteIssue(id) {
    customConfirm("Permanently delete this issue? All linked data (medicines, logs, visits, images) will be permanently deleted.", async () => {
        const user = await getUser();
        if (!user) return;
        const uid = user.id;

        showLoading(true);
        try {
            // 1. Get the issue to collect its prescription image
            const { data: issueData } = await supabaseClient.from('issues').select('prescription_url').eq('id', id).single();
            const issuePrescription = issueData?.prescription_url;

            // 2. Get all meets for this issue to collect prescription images and IDs
            const { data: meets } = await supabaseClient.from('meets').select('id, prescriptions').eq('issue_id', id);
            const meetIds = (meets || []).map(m => m.id);
            const meetPrescriptions = (meets || []).flatMap(m => m.prescriptions || []);

            // Combine all prescription URLs
            const allPrescriptionUrls = Array.from(new Set([
                ...(issuePrescription ? [issuePrescription] : []),
                ...meetPrescriptions
            ]));

            // 3. Get all medicines associated with this issue OR any of its meets
            const { data: issueMedicines } = await supabaseClient.from('medicines').select('id').eq('issue_id', id);
            let meetMedicines = [];
            if (meetIds.length > 0) {
                const { data: mm } = await supabaseClient.from('medicines').select('id').in('meet_id', meetIds);
                meetMedicines = mm || [];
            }
            
            const medIds = Array.from(new Set([
                ...(issueMedicines || []).map(m => m.id),
                ...(meetMedicines || []).map(m => m.id)
            ]));

            // 4. Delete logs associated with these medicines OR the issue
            if (medIds.length > 0) {
                await supabaseClient.from('logs').delete().in('medicine_id', medIds).eq('user_id', uid);
            }
            await supabaseClient.from('logs').delete().eq('issue_id', id).eq('user_id', uid);

            // 5. Delete medicines associated with the issue OR its meets
            if (medIds.length > 0) {
                await supabaseClient.from('medicines').delete().in('id', medIds).eq('user_id', uid);
            }

            // 6. Delete meets associated with the issue
            await supabaseClient.from('meets').delete().eq('issue_id', id).eq('user_id', uid);

            // 7. Delete the issue itself
            const { error } = await supabaseClient.from('issues').delete().eq('id', id).eq('user_id', uid);
            if (error) throw error;

            // 8. Delete images from storage (best effort)
            for (const url of allPrescriptionUrls) {
                try {
                    // Extract path from URL: .../prescriptions/USER_ID/FILENAME.jpg
                    const parts = url.split('/prescriptions/');
                    if (parts.length > 1) {
                        const path = parts[1];
                        await deleteImage('prescriptions', path);
                    }
                } catch (imgErr) {
                    console.warn("Failed to delete image from storage:", url, imgErr);
                }
            }

            // 9. Update in-memory state
            const medIdsStr = medIds.map(id => id.toString());
            state.issues = state.issues.filter(i => i.id.toString() !== id.toString());
            state.medicines = state.medicines.filter(m => !medIdsStr.includes(m.id.toString()));
            state.logs = state.logs.filter(l => l.issue_id?.toString() !== id.toString() && !medIdsStr.includes(l.medicine_id?.toString()));

            window.renderAllViews();
            customAlert("Issue and all related data deleted permanently!");
        } catch (err) {
            console.error("Error deleting issue permanently:", err.message || err);
            customAlert("Failed to delete issue permanently.");
        } finally {
            showLoading(false);
        }
    });
}

export function deleteIssue(id) {
    softDeleteIssue(id);
}

export async function saveMed() {
    const user = await getUser();
    if (!user) return;
    const uid = user.id;

    const id = document.getElementById('med-id').value;
    const name = document.getElementById('med-name').value.trim();
    const dosage = document.getElementById('med-dosage').value.trim();
    const start_date = document.getElementById('med-start').value;
    const end_date = document.getElementById('med-end').value;
    const issue_id = document.getElementById('med-issue-id').value;
    const meet_id = document.getElementById('med-meet-id').value;
    
    if (!issue_id) return customAlert("Please create and select an active issue first.");

    const timeInputs = document.querySelectorAll('.med-time-input');
    let times = [];
    timeInputs.forEach(ti => { if(ti.value) times.push(ti.value); });
    
    if(!name || !start_date || !end_date || times.length === 0) return customAlert("Please fill all required fields and add at least one time.");
    if(start_date > end_date) return customAlert("Start date cannot be after end date.");

    showLoading(true);
    try {
        // Smart Medicine Input: Check/Insert into medicine_master (Graceful failure for RLS)
        try {
            const existingMaster = state.medicineMaster.find(m => m.name.toLowerCase() === name.toLowerCase());
            if (!existingMaster) {
                const { data: masterData, error: masterError } = await supabaseClient
                    .from('medicine_master')
                    .upsert([{ name }], { onConflict: 'name' })
                    .select();
                
                if (!masterError && masterData && masterData.length > 0) {
                    if (!state.medicineMaster.find(m => m.id === masterData[0].id)) {
                        state.medicineMaster.push(masterData[0]);
                    }
                } else if (masterError) {
                    console.warn("Medicine master update skipped:", masterError.message);
                }
            }
        } catch (err) {
            console.warn("Could not update medicine_master (likely RLS restriction):", err);
            // We ignore this error as medicine_master is just for autocomplete suggestions
        }

        const issue = state.issues.find(i => i.id.toString() === issue_id.toString());
        const latestMeet = issue && issue.meets ? issue.meets[issue.meets.length - 1] : null;

        const medObj = {
            child_id: state.activeChildId,
            name, 
            dosage, 
            start_date, 
            end_date, 
            times,
            issue_id,
            meet_id: (meet_id && meet_id !== 'initial') ? meet_id : (latestMeet && latestMeet.id !== 'initial' ? latestMeet.id : null),
            user_id: uid
        };

        let result;
        if (id) {
            result = await supabaseClient.from('medicines').update(medObj).eq('id', id).eq('user_id', uid).select();
        } else {
            result = await supabaseClient.from('medicines').insert([medObj]).select();
        }

        if (result.error) throw result.error;

        let savedMed = result.data[0];
        if (typeof savedMed.times === 'string') {
            try { savedMed.times = JSON.parse(savedMed.times); } catch(e) { savedMed.times = []; }
        }
        if (!Array.isArray(savedMed.times)) savedMed.times = [];

        // Update issue meets to include this medicine if it's new
        if (!id) {
            const issue = state.issues.find(i => i.id.toString() === issue_id.toString());
            if (issue && issue.meets && issue.meets.length > 0) {
                const latestMeet = issue.meets[issue.meets.length - 1];
                if (latestMeet && latestMeet.id && latestMeet.id !== 'initial') {
                    // Update the medicine with the meet_id directly
                    await supabaseClient.from('medicines')
                        .update({ meet_id: latestMeet.id })
                        .eq('id', savedMed.id);
                    
                    savedMed.meet_id = latestMeet.id;
                }
            }
        }

        if (id) {
            const idx = state.medicines.findIndex(m => m.id.toString() === id.toString());
            if (idx !== -1) state.medicines[idx] = savedMed;
        } else {
            state.medicines.push(savedMed);
        }

        closeModal('modal-med');
        if (typeof window.refreshIssueReuseList === 'function') {
            window.refreshIssueReuseList();
        }
        window.renderAllViews();
        customAlert(id ? "Medicine updated!" : "Medicine added!");
    } catch (err) {
        console.error("Error saving medicine:", err.message || err);
        customAlert("Failed to save medicine.");
    } finally {
        showLoading(false);
    }
}

export async function deleteMed(id) {
    customConfirm("Delete this medicine? History will be kept.", async () => {
        const user = await getUser();
        if (!user) return;
        const uid = user.id;

        showLoading(true);
        try {
            const { error } = await supabaseClient.from('medicines').delete().eq('id', id).eq('user_id', uid);
            if (error) throw error;

            state.medicines = state.medicines.filter(m => m.id.toString() !== id.toString());
            window.renderAllViews();
        } catch (err) {
            console.error("Error deleting medicine:", err.message || err);
            customAlert("Failed to delete medicine.");
        } finally {
            showLoading(false);
        }
    });
}

export async function markMed(medicine_id, time, status) {
    const user = await getUser();
    if (!user) return;
    const uid = user.id;

    const date = window.getYYYYMMDD(new Date());
    const datetime = `${date}T${time}:00`;
    
    // Find medicine to get issue_id
    const med = state.medicines.find(m => m.id.toString() === medicine_id.toString());
    const issue_id = med ? med.issue_id : null;

    showLoading(true);
    try {
        const { data, error } = await supabaseClient.from('logs').insert([{
            medicine_id,
            child_id: state.activeChildId,
            status,
            datetime,
            issue_id,
            user_id: uid
        }]).select();

        if (error) throw error;

        state.logs.push(data[0]);
        window.renderAllViews();
    } catch (err) {
        console.error("Error logging medicine:", err.message || err);
        customAlert("Failed to log medicine.");
    } finally {
        showLoading(false);
    }
}

export async function undoLog(logId) {
    const user = await getUser();
    if (!user) return;
    const uid = user.id;

    showLoading(true);
    try {
        const { error } = await supabaseClient.from('logs').delete().eq('id', logId).eq('user_id', uid);
        if (error) throw error;

        state.logs = state.logs.filter(l => l.id !== logId);
        window.renderAllViews();
    } catch (err) {
        console.error("Error undoing log:", err.message || err);
        customAlert("Failed to undo log.");
    } finally {
        showLoading(false);
    }
}

export async function updateProfileSelectedChild(childId) {
    const user = await getUser();
    if (!user) return;
    const uid = user.id;

    try {
        const { error } = await supabaseClient
            .from('profiles')
            .update({ last_selected_child_id: childId })
            .eq('id', uid);
        
        if (error) {
            console.warn("Could not persist last_selected_child_id:", error.message);
        } else {
            if (state.profile) {
                state.profile.last_selected_child_id = childId;
            }
        }
    } catch (err) {
        console.warn("Failed to update profile selected child:", err);
    }
}

export async function saveProfile() {
    const user = await getUser();
    if (!user) return;
    const uid = user.id;

    const name = document.getElementById('profile-name').value.trim();
    if (!name) return customAlert("Name is required");

    showLoading(true);
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .update({ 
                name: name, 
                updated_at: new Date().toISOString() 
            })
            .eq('id', uid)
            .select()
            .single();

        if (error) throw error;
        
        state.profile = data;
        closeModal('modal-profile');
        if (window.renderProfile) window.renderProfile();
        customAlert("Profile updated successfully!");
    } catch (err) {
        console.error("Error updating profile:", err);
        customAlert("Failed to update profile: " + (err.message || err));
    } finally {
        showLoading(false);
    }
}

// --- GLOBAL EXPOSURE ---
window.saveChild = saveChild;
window.deleteChild = deleteChild;
window.saveMed = saveMed;
window.deleteMed = deleteMed;
window.markMed = markMed;
window.undoLog = undoLog;
window.saveIssue = saveIssue;
window.deleteIssue = deleteIssue;
window.softDeleteIssue = softDeleteIssue;
window.restoreIssue = restoreIssue;
window.permanentlyDeleteIssue = permanentlyDeleteIssue;
