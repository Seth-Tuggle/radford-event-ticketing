import { useState, useEffect } from "react";

const API_BASE_URL = "https://service.example.invalid/Sprint2/Group-1";

const BANNER_OPTIONS = [
  { id: "default", label: "RU Classic", style: "linear-gradient(135deg, #002654 0%, #0a1a3e 45%, #1a0000 70%, #cc0000 100%)" },
  { id: "navy", label: "Navy", style: "linear-gradient(135deg, #002654, #003a8c)" },
  { id: "red", label: "Crimson", style: "linear-gradient(135deg, #7a0000, #cc0000)" },
  { id: "sunset", label: "Sunset", style: "linear-gradient(135deg, #1a0000, #cc0000, #ff6b35)" },
  { id: "night", label: "Night", style: "linear-gradient(135deg, #0a0a1a, #1a1a3e, #002654)" },
  { id: "forest", label: "Forest", style: "linear-gradient(135deg, #0a2e0a, #1a5c1a, #2d8a2d)" },
];

function decodeJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64).split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    return JSON.parse(jsonPayload);
  } catch { return null; }
}

function getToken() {
  return sessionStorage.getItem("idToken") || sessionStorage.getItem("accessToken");
}

export default function Profile({ onNavigate }) {
  const [view, setView] = useState("profile");
  const [activeTab, setActiveTab] = useState("info");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [profileData, setProfileData] = useState({
    userId: "", displayName: "", username: "", bio: "", email: "", role: "", photoUrl: "",
    bannerStyle: BANNER_OPTIONS[0].style,
  });

  const [editData, setEditData] = useState({ displayName: "", bio: "", gradYear: "", gender: "", age: "" });
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [pendingBanner, setPendingBanner] = useState(null);

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    const token = getToken();
    if (!token) { setError("You must be logged in to view your profile."); setLoading(false); return; }
    const decoded = decodeJwt(token);
    if (!decoded) { setLoading(false); return; }
    const userId = decoded.sub;
    try {
      const res = await fetch(`${API_BASE_URL}/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load profile");
      const data = await res.json();
      setProfileData({
        userId,
        displayName: data.DisplayName || "",
        username: data.Username || "",
        bio: data.Bio || data.bio || "",
        email: data.Email || "",
        role: data.Role || "",
        photoUrl: data.photoUrl || "",
        bannerStyle: data.bannerStyle || BANNER_OPTIONS[0].style,
        gradYear: data.GradYear || "",
        gender: data.Gender || "",
        age: data.Age || "",
});
    } catch (err) {
      setError("Could not load profile: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function convertToBase64(file) {
    // Resize image to max 400x400 to keep DynamoDB storage small
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
          canvas.width = w;
          canvas.height = h;
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

  async function saveProfile() {
    const token = getToken();
    if (!token || !profileData.userId) return;
    setSaving(true);
    setError("");

    try {
      let photoUrl = profileData.photoUrl;
      let bannerStyle = profileData.bannerStyle;

      if (pendingPhoto?.file) {
        setUploadingPhoto(true);
        try { photoUrl = await convertToBase64(pendingPhoto.file); }
        finally { setUploadingPhoto(false); }
      }

      if (pendingBanner) bannerStyle = pendingBanner;

      const res = await fetch(`${API_BASE_URL}/users/${profileData.userId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: editData.displayName, bio: editData.bio, photoUrl, bannerStyle, gradYear: editData.gradYear, gender: editData.gender, age: editData.age }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Save failed");
      }

      setProfileData((prev) => ({ ...prev, displayName: editData.displayName, bio: editData.bio, photoUrl, bannerStyle, gradYear: editData.gradYear, gender: editData.gender, age: editData.age }));
      setPendingPhoto(null);
      setPendingBanner(null);
      setSuccess("Profile saved!");
      setTimeout(() => { setSuccess(""); setView("profile"); }, 800);
    } catch (err) {
      setError("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  function goToEdit() {
    setEditData({ displayName: profileData.displayName, bio: profileData.bio, gradYear: profileData.gradYear, gender: profileData.gender, age: profileData.age });
    setPendingPhoto(null);
    setPendingBanner(null);
    setActiveTab("info");
    setError("");
    setView("edit");
  }

  function handlePhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const previewURL = URL.createObjectURL(file);
    setPendingPhoto({ file, previewURL });
  }

  const currentPhoto = pendingPhoto?.previewURL || profileData.photoUrl || null;
  const currentBanner = pendingBanner || profileData.bannerStyle || BANNER_OPTIONS[0].style;

  const s = {
    page: { width: "100%", maxWidth: "100%", margin: "0 auto" },
    card: { background: "var(--color-background-primary)", borderRadius: "12px", overflow: "hidden", border: "0.5px solid var(--color-border-tertiary)", width: "100%" },
    banner: { height: "120px", background: currentBanner },
    avatarWrap: { padding: "0 20px", marginTop: "-40px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "8px" },
    avatar: { width: "80px", height: "80px", borderRadius: "50%", border: "4px solid var(--color-background-primary)", background: "var(--color-background-secondary)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
    info: { padding: "4px 20px 18px", display: "flex", gap: "16px", alignItems: "flex-start" },
    infoLeft: { flex: 1 },
    displayName: { fontSize: "16px", fontWeight: "500", color: "var(--color-text-primary)", margin: "0 0 2px" },
    username: { fontSize: "13px", color: "var(--color-text-secondary)", margin: "0 0 6px" },
    bio: { fontSize: "14px", color: "var(--color-text-secondary)", margin: 0, lineHeight: "1.55" },
    bioEmpty: { fontSize: "14px", color: "var(--color-text-secondary)", margin: 0, fontStyle: "italic", opacity: 0.7 },
    editBtn: { padding: "7px 16px", borderRadius: "20px", border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "var(--color-text-primary)", whiteSpace: "nowrap", marginTop: "4px" },
    editCard: { background: "var(--color-background-primary)", borderRadius: "12px", overflow: "hidden", border: "0.5px solid var(--color-border-tertiary)", width: "100%" },
    editHeader: { padding: "16px 20px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: "10px" },
    backBtn: { width: "30px", height: "30px", borderRadius: "50%", border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0, color: "var(--color-text-primary)" },
    tabs: { display: "flex", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0 20px" },
    tab: (active) => ({ padding: "10px 0", marginRight: "20px", fontSize: "13px", fontWeight: active ? "500" : "400", color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)", borderBottom: active ? "2px solid #cc0000" : "2px solid transparent", background: "none", border: "none", borderBottom: active ? "2px solid #cc0000" : "2px solid transparent", cursor: "pointer", fontFamily: "inherit" }),
    formBody: { padding: "20px", display: "flex", flexDirection: "column", gap: "16px" },
    fieldLabel: { display: "block", fontSize: "11px", fontWeight: "500", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "5px" },
    fieldInput: { width: "100%", padding: "9px 12px", borderRadius: "8px", border: "0.5px solid var(--color-border-secondary)", fontSize: "14px", fontFamily: "inherit", outline: "none", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", boxSizing: "border-box" },
    textarea: { width: "100%", padding: "9px 12px", borderRadius: "8px", border: "0.5px solid var(--color-border-secondary)", fontSize: "14px", fontFamily: "inherit", outline: "none", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", boxSizing: "border-box", minHeight: "80px", resize: "vertical" },
    footer: { padding: "14px 20px", borderTop: "0.5px solid var(--color-border-tertiary)", display: "flex", justifyContent: "flex-end", gap: "8px" },
    cancelBtn: { padding: "8px 18px", borderRadius: "8px", border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "var(--color-text-primary)", fontFamily: "inherit" },
    saveBtn: { padding: "8px 18px", borderRadius: "8px", border: "none", background: "#cc0000", color: "#fff", fontSize: "13px", fontWeight: "500", cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: saving ? 0.6 : 1 },
    alert: (type) => ({ padding: "9px 12px", borderRadius: "8px", fontSize: "13px", background: type === "error" ? "var(--color-background-danger)" : "var(--color-background-success)", border: `0.5px solid ${type === "error" ? "var(--color-border-danger)" : "var(--color-border-success)"}`, color: type === "error" ? "var(--color-text-danger)" : "var(--color-text-success)", marginBottom: "10px" }),
  };

  if (loading) return <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-text-secondary)", fontSize: "14px" }}>Loading profile...</div>;

  if (view === "profile") {
    return (
      <div style={s.page}>
        {error && <div style={s.alert("error")}>{error}</div>}
        <div style={s.card}>
          <div style={s.banner} />
          <div style={s.avatarWrap}>
            <div style={s.avatar}>
              {currentPhoto ? (
                <img src={currentPhoto} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.4">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
              )}
            </div>
            <button style={s.editBtn} onClick={goToEdit}>Edit Profile</button>
          </div>
          <div style={s.info}>
            <div style={s.infoLeft}>
              <p style={s.displayName}>{profileData.displayName || "Highlander"}</p>
              <p style={s.username}>@{profileData.username || "username"}</p>
              {profileData.bio
                ? <p style={s.bio}>{profileData.bio}</p>
                : <p style={s.bioEmpty}>No bio yet — tap Edit Profile to add one.</p>
              }
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      {error && <div style={s.alert("error")}>{error}</div>}
      {success && <div style={s.alert("success")}>{success}</div>}
      <div style={s.editCard}>
        <div style={s.editHeader}>
          <button style={s.backBtn} onClick={() => setView("profile")}>←</button>
          <div>
            <div style={{ fontWeight: "500", fontSize: "15px", color: "var(--color-text-primary)" }}>Edit Profile</div>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Update your photo, banner, and bio</div>
          </div>
        </div>

        <div style={s.tabs}>
          <button style={s.tab(activeTab === "info")} onClick={() => setActiveTab("info")}>Info & Bio</button>
          <button style={s.tab(activeTab === "photo")} onClick={() => setActiveTab("photo")}>Photo</button>
          <button style={s.tab(activeTab === "banner")} onClick={() => setActiveTab("banner")}>Banner</button>
        </div>

        {activeTab === "info" && (
          <>
            <div style={s.formBody}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ ...s.avatar, width: "56px", height: "56px", border: "0.5px solid var(--color-border-tertiary)", flexShrink: 0 }}>
                  {currentPhoto ? (
                    <img src={currentPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.4">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                    </svg>
                  )}
                </div>
                <button style={{ ...s.cancelBtn, fontSize: "12px" }} onClick={() => setActiveTab("photo")}>Change Photo</button>
              </div>

              <div>
                <label style={s.fieldLabel}>Display Name</label>
                <input type="text" style={s.fieldInput} value={editData.displayName} onChange={(e) => setEditData({ ...editData, displayName: e.target.value })} placeholder="Your display name" maxLength={50} />
              </div>

              <div>
                <label style={s.fieldLabel}>Username</label>
                <input type="text" style={{ ...s.fieldInput, opacity: 0.5, cursor: "not-allowed" }} value={profileData.username} readOnly />
                <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: "3px 0 0" }}>Username cannot be changed</p>
              </div>

              <div>
                <label style={s.fieldLabel}>Bio</label>
                <textarea style={s.textarea} value={editData.bio} onChange={(e) => setEditData({ ...editData, bio: e.target.value })} placeholder="Tell people a little about yourself…" maxLength={150} />
                <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: "3px 0 0", textAlign: "right" }}>{editData.bio.length} / 150</p>
              </div>
            </div>
            <div>
  <label style={s.fieldLabel}>Age</label>
  <input type="number" style={s.fieldInput} value={editData.age}
    onChange={(e) => setEditData({ ...editData, age: e.target.value })}
    placeholder="Your age" min={1} max={120} />
</div>

<div>
  <label style={s.fieldLabel}>Gender</label>
  <select style={s.fieldInput} value={editData.gender}
    onChange={(e) => setEditData({ ...editData, gender: e.target.value })}>
    <option value="">Prefer not to say</option>
    <option value="Male">Male</option>
    <option value="Female">Female</option>
    <option value="Non-binary">Non-binary</option>
    <option value="Other">Other</option>
  </select>
</div>

<div>
  <label style={s.fieldLabel}>Graduation Year</label>
  <select style={s.fieldInput} value={editData.gradYear}
    onChange={(e) => setEditData({ ...editData, gradYear: e.target.value })}>
    <option value="">Select year</option>
    {[2025, 2026, 2027, 2028, 2029, 2030].map(y => (
      <option key={y} value={y}>{y}</option>
    ))}
  </select>
</div>
            <div style={s.footer}>
              <button style={s.cancelBtn} onClick={() => setView("profile")}>Cancel</button>
              <button style={s.saveBtn} onClick={saveProfile} disabled={saving}>
                {saving ? (uploadingPhoto ? "Uploading photo..." : "Saving...") : "Save Changes"}
              </button>
            </div>
          </>
        )}

        {activeTab === "photo" && (
          <>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
              <div style={{ width: "100px", height: "100px", borderRadius: "50%", overflow: "hidden", border: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {currentPhoto ? (
                  <img src={currentPhoto} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.4">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </div>
              <label style={{ padding: "8px 20px", borderRadius: "8px", border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-secondary)", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "var(--color-text-primary)" }}>
                Choose Photo
                <input type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: "none" }} />
              </label>
              {pendingPhoto && <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", margin: 0 }}>Photo selected — hit Save Changes to upload it</p>}
              {currentPhoto && (
                <button style={{ ...s.cancelBtn, fontSize: "12px" }} onClick={() => { setPendingPhoto(null); setProfileData(p => ({ ...p, photoUrl: "" })); }}>
                  Remove Photo
                </button>
              )}
            </div>
            <div style={s.footer}>
              <button style={s.cancelBtn} onClick={() => setActiveTab("info")}>Back</button>
              <button style={s.saveBtn} onClick={() => setActiveTab("info")}>Done</button>
            </div>
          </>
        )}

        {activeTab === "banner" && (
          <>
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ width: "100%", height: "80px", borderRadius: "8px", background: currentBanner, border: "0.5px solid var(--color-border-tertiary)" }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                {BANNER_OPTIONS.map((opt) => {
                  const isSelected = currentBanner === opt.style;
                  return (
                    <div key={opt.id} onClick={() => setPendingBanner(opt.style)} style={{ cursor: "pointer", borderRadius: "8px", overflow: "hidden", border: isSelected ? "2px solid #cc0000" : "0.5px solid var(--color-border-tertiary)" }}>
                      <div style={{ height: "48px", background: opt.style }} />
                      <div style={{ padding: "4px 8px", background: "var(--color-background-secondary)", fontSize: "11px", color: "var(--color-text-secondary)", textAlign: "center" }}>{opt.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={s.footer}>
              <button style={s.cancelBtn} onClick={() => setActiveTab("info")}>Back</button>
              <button style={s.saveBtn} onClick={() => setActiveTab("info")}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
