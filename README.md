<div align="center">

<img src="https://iili.io/qJ8GGYg.png?font=Fira+Code&size=34&duration=3000&pause=1000&color=FFFFFF&center=true&vCenter=true&width=800&lines=✧+OMEGLE_RTC+✧;Random+Video+Chat;WebRTC+•+Firebase+•+Next.js" alt="Project Banner" />

<br/>

<p align="center">
  <img src="https://img.shields.io/badge/WebRTC-P2P-FF6B6B?style=for-the-badge&logo=webrtc&logoColor=white" />
  <img src="https://img.shields.io/badge/Firebase-Signaling-FFCA28?style=for-the-badge&logo=firebase&logoColor=black" />
  <img src="https://img.shields.io/badge/Next.js-App_Router-000000?style=for-the-badge&logo=next.js" />
</p>

<p align="center">
  <a href="#demo-link">
    <img src="https://img.shields.io/badge/LIVE_DEMO-00C853?style=for-the-badge&logo=vercel&logoColor=white" />
  </a>
  <a href="#repo-link">
    <img src="https://img.shields.io/badge/GITHUB_REPO-181717?style=for-the-badge&logo=github&logoColor=white" />
  </a>
</p>

</div>

---

## 📽️ The Vision
**Omegle_RTC** is a modern, decentralized video chat platform that connects strangers globally in real-time. By leveraging **WebRTC** for P2P media streaming and **Firebase Cloud Firestore** for sub-second signaling, the platform ensures high-quality video with minimal server overhead.

---

## 🚀 Key Features

* **🎭 Instant Random Pairing:** Smart matchmaking logic that pairs users the moment they click "Start."
* **📹 Low-Latency Video:** Direct Peer-to-Peer streaming using WebRTC `RTCPeerConnection`.
* **📡 Firebase Signaling:** High-speed exchange of SDP (Session Description Protocol) and ICE candidates.
* **💬 Real-time Text Overlay:** Simultaneous text chat alongside video using `RTCDataChannel`.
* **📱 Adaptive Layout:** Fully responsive UI that handles camera orientation and grid resizing across all devices.
* **🛡️ Secure & Anonymous:** No data is stored on servers; once the session ends, the connection is destroyed.

---

## 🏗️ Technical Architecture

| Component | Responsibility | Technology |
| :--- | :--- | :--- |
| **Media Capture** | Camera/Microphone Access | `navigator.mediaDevices` |
| **Signaling** | SDP & ICE Candidate Exchange | `Firebase Firestore` |
| **P2P Engine** | Peer-to-Peer Connection | `WebRTC API` |
| **Frontend** | UI & State Management | `React / Next.js` |
| **Style** | Visual Design | `Tailwind CSS` |

---

## 📸 Interface Preview

<div align="center">
  <img src="https://iili.io/qJ8wNOF.png" width="95%" style="border-radius: 15px; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" />
  <p><i>Sub-second latency random video pairing in action.</i></p>
</div>

---

## 🛠️ How it Works (The Flow)

1.  **Waitlist:** When a user clicks start, they are added to a "waiting" collection in Firestore.
2.  **Matchmaking:** A background listener checks for available peers.
3.  **Offer/Answer:** Peer A generates an **SDP Offer** and writes it to Firestore; Peer B listens, generates an **Answer**, and writes it back.
4.  **ICE Candidates:** Both peers exchange network information (ICE candidates) via Firestore to bypass NAT/Firewalls.
5.  **Streaming:** Once connected, the video/audio stream bypasses the server entirely for 0ms server-lag.

---

## ⚙️ Setup & Deployment

1. **Clone & Install**
   ```bash
   git clone [https://github.com/YourUsername/ProjectName.git](https://github.com/YourUsername/ProjectName.git)
   npm install
