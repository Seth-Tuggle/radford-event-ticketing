/**
 * @file components/Profile.jsx
 * @description User profile view and edit component.
 *
 * Loads profile from localStorage cache (populated at login by auth.js).
 * Falls back to POST /me if no cache exists.
 * Saves edits via PUT /users/{userId} and updates the localStorage cache.
 *
 * Tabs: Info & Bio | Photo | Banner
 */
import { useState, useEffect } from "react";
import { getTokens, decodeJwt, getUserSub } from "../auth";

const API_BASE_URL =
  "https://service.example.invalid/Sprint2/Group-1";

const C = {
  bgPrimary: "#ffffff", bgSecondary: "#f5f5f5",
  textPrimary: "#1a1a1a", textSecondary: "#666666",
  borderTertiary: "#e5e5e5", borderSecondary: "#d0d0d0",
  red: "#cc0000",
  bgDanger: "#fef2f2", bgSuccess: "#f0fdf4",
  borderDanger: "#fca5a5", borderSuccess: "#86efac",
  textDanger: "#dc2626", textSuccess: "#16a34a",
};

const BANNER_OPTIONS = [
  { id: "default", label: "RU Classic", style: "linear-gradient(135deg, #002654 0%, #0a1a3e 45%, #1a0000 70%, #cc0000 100%)" },
  { id: "navy", label: "Navy", style: "linear-gradient(135deg, #002654, #003a8c)" },
  { id: "red", label: "Crimson", style: "linear-gradient(135deg, #7a0000, #cc0000)" },
  { id: "sunset", label: "Sunset", style: "linear-gradient(135deg, #1a0000, #cc0000, #ff6b35)" },
  { id: "night", label: "Night", style: "linear-gradient(135deg, #0a0a1a, #1a1a3e, #002654)" },
  { id: "forest", label: "Forest", style: "linear-gradient(135deg, #0a2e0a, #1a5c1a, #2d8a2d)" },
];

function getSavedProfile() {
  try {
    const raw = localStorage.getItem("userProfile");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export default function Profile() {
  const [mode, setMode] = useState("view");
  const [activeTab, setActiveTab] = useState("info");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [profileData, setProfileData] = useState({
    userId: "", displayName: "", username: "", bio: "", email: "", role: "",
    photoUrl: "", bannerStyle: BANNER_OPTIONS[0].style,
    gradYear: "", gender: "", age: "", phoneNumber: "",
  });

  const [editData, setEditData] = useState({
    displayName: "", bio: "", gradYear: "", gender: "", age: "", phoneNumber: "",
  });
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [pendingBanner, setPendingBanner] = useState(null);

  useEffect(() => { loadProfile(); }, []);

  function mapCachedToState(cached, fallbackUserId) {
    return {
      userId: cached.userId || fallbackUserId || "",
      displayName: cached.DisplayName || cached.displayName || "",
      username: cached.Username || cached.username || "",
      bio: cached.Bio || cached.bio || "",
      email: cached.Email || cached.email || "",
      role: cached.Role || cached.role || "",
      photoUrl: cached.photoUrl || "",
      bannerStyle: cached.bannerStyle || BANNER_OPTIONS[0].style,
      gradYear: cached.GradYear || cached.gradYear || "",
      gender: cached.Gender || cached.gender || "",
      age: cached.Age != null ? String(cached.Age) : (cached.age != null ? String(cached.age) : ""),
      phoneNumber: cached.PhoneNumber || cached.phoneNumber || "",
    };
  }

  function loadProfile() {
    // Try localStorage cache first
    const cached = getSavedProfile();
    if (cached) {
      setProfileData(mapCachedToState(cached));
      setLoading(false);
      return;
    }

    // Fallback: call POST /me with tokens
    const { idToken, accessToken } = getTokens();
    if (!idToken && !accessToken) {
      setError("You must be logged in.");
      setLoading(false);
      return;
    }

    fetch(`${API_BASE_URL}/me`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, idToken }),
    })
      .then((r) => r.ok ? r.json() : Promise.reject("Failed to load profile"))
      .then((data) => {
        const profile = data.userProfile || data;
        localStorage.setItem("userProfile", JSON.stringify(profile));
        setProfileData(mapCachedToState(profile));
      })
      .catch((err) => setError("Could not load profile: " + err))
      .finally(() => setLoading(false));
  }

  async function convertToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX = 400;
          let w = img.width, h = img.height;
          if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
          else { if (h > MAX) { w = w * MAX / h; h = MAX; } }
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSaveProfile() {
    const { idToken, accessToken } = getTokens();
    const token = idToken || accessToken;
    if (!token || !profileData.userId) return;
    setSaving(true); setError("");

    try {
      let photoUrl = profileData.photoUrl;
      let bannerStyle = profileData.bannerStyle;
      if (pendingPhoto?.file) {
        setUploadingPhoto(true);
        try { photoUrl = await convertToBase64(pendingPhoto.file); } finally { setUploadingPhoto(false); }
      }
      if (pendingBanner) bannerStyle = pendingBanner;

      const payload = {
        displayName: editData.displayName,
        bio: editData.bio,
        photoUrl,
        bannerStyle,
        gradYear: editData.gradYear,
        gender: editData.gender,
        age: editData.age,
        phoneNumber: editData.phoneNumber,
      };

      const res = await fetch(`${API_BASE_URL}/users/${profileData.userId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Save failed"); }

      // Update local state
      setProfileData((p) => ({
        ...p,
        displayName: editData.displayName,
        bio: editData.bio,
        photoUrl,
        bannerStyle,
        gradYear: editData.gradYear,
        gender: editData.gender,
        age: editData.age,
        phoneNumber: editData.phoneNumber,
      }));

      // Update localStorage cache so Header/Nav see fresh data
      const cached = getSavedProfile() || {};
      const updatedCache = {
        ...cached,
        DisplayName: editData.displayName,
        Bio: editData.bio,
        photoUrl,
        bannerStyle,
        GradYear: editData.gradYear,
        Gender: editData.gender,
        Age: editData.age,
        PhoneNumber: editData.phoneNumber,
      };
      localStorage.setItem("userProfile", JSON.stringify(updatedCache));
      window.dispatchEvent(new StorageEvent("storage", { key: "userProfile" }));

      setPendingPhoto(null); setPendingBanner(null);
      setSuccess("Profile saved!");
      setTimeout(() => { setSuccess(""); setMode("view"); }, 800);
    } catch (err) {
      setError("Save failed: " + err.message);
    } finally { setSaving(false); }
  }

  function goToEdit() {
    setEditData({
      displayName: profileData.displayName,
      bio: profileData.bio,
      gradYear: profileData.gradYear,
      gender: profileData.gender,
      age: profileData.age,
      phoneNumber: profileData.phoneNumber,
    });
    setPendingPhoto(null); setPendingBanner(null);
    setActiveTab("info"); setError(""); setMode("edit");
  }

  function handlePhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPendingPhoto({ file, previewURL: URL.createObjectURL(file) });
  }

  const currentPhoto = pendingPhoto?.previewURL || profileData.photoUrl || null;
  const currentBanner = pendingBanner || profileData.bannerStyle || BANNER_OPTIONS[0].style;

  // Styles
  const card = { background: C.bgPrimary, borderRadius: "12px", overflow: "hidden", border: `0.5px solid ${C.borderTertiary}`, width: "100%", color: C.textPrimary };
  const avatar = { width: "80px", height: "80px", borderRadius: "50%", border: `4px solid ${C.bgPrimary}`, background: C.bgSecondary, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 };
  const btn = { padding: "7px 16px", borderRadius: "20px", border: `0.5px solid ${C.borderSecondary}`, background: C.bgPrimary, fontSize: "13px", fontWeight: "500", cursor: "pointer", color: C.textPrimary };
  const input = { width: "100%", padding: "9px 12px", borderRadius: "8px", border: `0.5px solid ${C.borderSecondary}`, fontSize: "14px", fontFamily: "inherit", outline: "none", background: C.bgSecondary, color: C.textPrimary, boxSizing: "border-box" };
  const fieldLabel = { display: "block", fontSize: "11px", fontWeight: "500", color: C.textSecondary, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "5px" };
  const alert = (t) => ({ padding: "9px 12px", borderRadius: "8px", fontSize: "13px", background: t === "error" ? C.bgDanger : C.bgSuccess, border: `0.5px solid ${t === "error" ? C.borderDanger : C.borderSuccess}`, color: t === "error" ? C.textDanger : C.textSuccess, marginBottom: "10px" });
  const tab = (a) => ({ padding: "10px 0", marginRight: "20px", fontSize: "13px", fontWeight: a ? "500" : "400", color: a ? C.textPrimary : C.textSecondary, background: "none", border: "none", borderBottom: a ? `2px solid ${C.red}` : "2px solid transparent", cursor: "pointer", fontFamily: "inherit" });

  if (loading) return <div style={{ textAlign: "center", padding: "3rem", color: C.textSecondary, fontSize: "14px" }}>Loading profile...</div>;

  // ==================== VIEW MODE ====================
  if (mode === "view") {
    return (
      <div style={{ width: "100%" }}>
        {error && <div style={alert("error")}>{error}</div>}
        <div style={card}>
          <div style={{ height: "120px", background: currentBanner }} />
          <div style={{ padding: "0 20px", marginTop: "-40px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "8px" }}>
            <div style={avatar}>
              {currentPhoto
                ? <img src={currentPhoto} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="1.4"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              }
            </div>
            <button style={btn} onClick={goToEdit}>Edit Profile</button>
          </div>
          <div style={{ padding: "4px 20px 18px" }}>
            <p style={{ fontSize: "16px", fontWeight: "500", color: C.textPrimary, margin: "0 0 2px" }}>{profileData.displayName || "Highlander"}</p>
            <p style={{ fontSize: "13px", color: C.textSecondary, margin: "0 0 6px" }}>@{profileData.username || "username"}</p>
            {profileData.bio
              ? <p style={{ fontSize: "14px", color: C.textSecondary, margin: 0, lineHeight: "1.55" }}>{profileData.bio}</p>
              : <p style={{ fontSize: "14px", color: C.textSecondary, margin: 0, fontStyle: "italic", opacity: 0.7 }}>No bio yet — tap Edit Profile to add one.</p>
            }
            {/* Detail chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
              {profileData.age && <span style={{ fontSize: "12px", padding: "3px 10px", borderRadius: "12px", background: C.bgSecondary, color: C.textSecondary }}>Age: {profileData.age}</span>}
              {profileData.gender && <span style={{ fontSize: "12px", padding: "3px 10px", borderRadius: "12px", background: C.bgSecondary, color: C.textSecondary }}>{profileData.gender}</span>}
              {profileData.gradYear && <span style={{ fontSize: "12px", padding: "3px 10px", borderRadius: "12px", background: C.bgSecondary, color: C.textSecondary }}>Class of {profileData.gradYear}</span>}
              {profileData.phoneNumber && <span style={{ fontSize: "12px", padding: "3px 10px", borderRadius: "12px", background: C.bgSecondary, color: C.textSecondary }}>{profileData.phoneNumber}</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==================== EDIT MODE ====================
  return (
    <div style={{ width: "100%" }}>
      {error && <div style={alert("error")}>{error}</div>}
      {success && <div style={alert("success")}>{success}</div>}
      <div style={card}>
        <div style={{ padding: "16px 20px", borderBottom: `0.5px solid ${C.borderTertiary}`, display: "flex", alignItems: "center", gap: "10px" }}>
          <button onClick={() => setMode("view")} style={{ width: "30px", height: "30px", borderRadius: "50%", border: `0.5px solid ${C.borderSecondary}`, background: C.bgSecondary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", color: C.textPrimary }}>←</button>
          <div>
            <div style={{ fontWeight: "500", fontSize: "15px", color: C.textPrimary }}>Edit Profile</div>
            <div style={{ fontSize: "12px", color: C.textSecondary }}>Update your photo, banner, and bio</div>
          </div>
        </div>

        <div style={{ display: "flex", borderBottom: `0.5px solid ${C.borderTertiary}`, padding: "0 20px" }}>
          <button style={tab(activeTab === "info")} onClick={() => setActiveTab("info")}>Info & Bio</button>
          <button style={tab(activeTab === "photo")} onClick={() => setActiveTab("photo")}>Photo</button>
          <button style={tab(activeTab === "banner")} onClick={() => setActiveTab("banner")}>Banner</button>
        </div>

        {activeTab === "info" && (
          <>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ ...avatar, width: "56px", height: "56px", border: `0.5px solid ${C.borderTertiary}` }}>
                  {currentPhoto
                    ? <img src={currentPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="1.4"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  }
                </div>
                <button style={{ ...btn, fontSize: "12px" }} onClick={() => setActiveTab("photo")}>Change Photo</button>
              </div>

              <div>
                <label style={fieldLabel}>Display Name</label>
                <input type="text" style={input} value={editData.displayName} onChange={(e) => setEditData({ ...editData, displayName: e.target.value })} maxLength={50} />
              </div>

              <div>
                <label style={fieldLabel}>Username</label>
                <input type="text" style={{ ...input, opacity: 0.5, cursor: "not-allowed" }} value={profileData.username} readOnly />
                <p style={{ fontSize: "11px", color: C.textSecondary, margin: "3px 0 0" }}>Username cannot be changed</p>
              </div>

              <div>
                <label style={fieldLabel}>Email</label>
                <input type="text" style={{ ...input, opacity: 0.5, cursor: "not-allowed" }} value={profileData.email} readOnly />
                <p style={{ fontSize: "11px", color: C.textSecondary, margin: "3px 0 0" }}>Contact an admin to change your email</p>
              </div>

              <div>
                <label style={fieldLabel}>Bio</label>
                <textarea style={{ ...input, minHeight: "80px", resize: "vertical" }} value={editData.bio} onChange={(e) => setEditData({ ...editData, bio: e.target.value })} maxLength={150} />
                <p style={{ fontSize: "11px", color: C.textSecondary, margin: "3px 0 0", textAlign: "right" }}>{editData.bio.length} / 150</p>
              </div>

              <div>
                <label style={fieldLabel}>Phone Number</label>
                <input type="tel" style={input} value={editData.phoneNumber} onChange={(e) => setEditData({ ...editData, phoneNumber: e.target.value })} placeholder="e.g. +1234567890" />
              </div>

              <div>
                <label style={fieldLabel}>Age</label>
                <input type="number" style={input} value={editData.age} onChange={(e) => setEditData({ ...editData, age: e.target.value })} placeholder="Your age" min={1} max={120} />
              </div>

              <div>
                <label style={fieldLabel}>Gender</label>
                <select style={input} value={editData.gender} onChange={(e) => setEditData({ ...editData, gender: e.target.value })}>
                  <option value="">Prefer not to say</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label style={fieldLabel}>Graduation Year</label>
                <select style={input} value={editData.gradYear} onChange={(e) => setEditData({ ...editData, gradYear: e.target.value })}>
                  <option value="">Select year</option>
                  {[2025, 2026, 2027, 2028, 2029, 2030].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            <div style={{ padding: "14px 20px", borderTop: `0.5px solid ${C.borderTertiary}`, display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button style={btn} onClick={() => setMode("view")}>Cancel</button>
              <button onClick={handleSaveProfile} disabled={saving} style={{ padding: "8px 18px", borderRadius: "8px", border: "none", background: C.red, color: "#fff", fontSize: "13px", fontWeight: "500", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
                {saving ? (uploadingPhoto ? "Uploading photo..." : "Saving...") : "Save Changes"}
              </button>
            </div>
          </>
        )}

        {activeTab === "photo" && (
          <>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
              <div style={{ width: "100px", height: "100px", borderRadius: "50%", overflow: "hidden", border: `0.5px solid ${C.borderTertiary}`, background: C.bgSecondary, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {currentPhoto ? <img src={currentPhoto} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="1.4"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
              </div>
              <label style={{ ...btn, cursor: "pointer" }}>Choose Photo<input type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: "none" }} /></label>
              {pendingPhoto && <p style={{ fontSize: "12px", color: C.textSecondary, margin: 0 }}>Photo selected — hit Save Changes to upload</p>}
              {currentPhoto && <button style={{ ...btn, fontSize: "12px" }} onClick={() => { setPendingPhoto(null); setProfileData(p => ({ ...p, photoUrl: "" })); }}>Remove Photo</button>}
            </div>
            <div style={{ padding: "14px 20px", borderTop: `0.5px solid ${C.borderTertiary}`, display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button style={btn} onClick={() => setActiveTab("info")}>Back</button>
              <button style={{ ...btn, background: C.red, color: "#fff", border: "none" }} onClick={() => setActiveTab("info")}>Done</button>
            </div>
          </>
        )}

        {activeTab === "banner" && (
          <>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ width: "100%", height: "80px", borderRadius: "8px", background: currentBanner, border: `0.5px solid ${C.borderTertiary}` }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                {BANNER_OPTIONS.map((opt) => (
                  <div key={opt.id} onClick={() => setPendingBanner(opt.style)} style={{ cursor: "pointer", borderRadius: "8px", overflow: "hidden", border: currentBanner === opt.style ? `2px solid ${C.red}` : `0.5px solid ${C.borderTertiary}` }}>
                    <div style={{ height: "48px", background: opt.style }} />
                    <div style={{ padding: "4px 8px", background: C.bgSecondary, fontSize: "11px", color: C.textSecondary, textAlign: "center" }}>{opt.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: "14px 20px", borderTop: `0.5px solid ${C.borderTertiary}`, display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button style={btn} onClick={() => setActiveTab("info")}>Back</button>
              <button style={{ ...btn, background: C.red, color: "#fff", border: "none" }} onClick={() => setActiveTab("info")}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
