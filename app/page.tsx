"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  onChildAdded,
  remove,
  update,
  onDisconnect,
  get,
  Unsubscribe,
} from "firebase/database";

// ────────────────────────────────────────────────
// Firebase Setup
// ────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCpX68nuBj2_ioYAehdYsaBxZsx7nwHeh0",
  authDomain: "video-chat-e39bf.firebaseapp.com",
  databaseURL: "https://video-chat-e39bf-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "video-chat-e39bf",
  storageBucket: "video-chat-e39bf.firebasestorage.app",
  messagingSenderId: "318016664014",
  appId: "1:318016664014:web:c1322ac800ede20174fb9f",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getDatabase(app);

const iceServers = {
  iceServers: [
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

export default function Omegle2010Light() {
  const [mode, setMode] = useState<"home" | "chat">("home");
  const [messages, setMessages] = useState<{ text: string; uid: string }[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Start chatting");
  const [onlineCount, setOnlineCount] = useState(0);

  const myId = useRef(`u_${Math.random().toString(36).slice(2, 9)}`).current;
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const currentRoomId = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const listenersRef = useRef<Unsubscribe[]>([]);

  const addListener = useCallback((unsub: Unsubscribe) => {
    listenersRef.current.push(unsub);
  }, []);

  const cleanupRoom = useCallback(async () => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;

    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    listenersRef.current.forEach((u) => u());
    listenersRef.current = [];

    if (currentRoomId.current) {
      const rid = currentRoomId.current;
      await update(ref(db, `rooms/${rid}`), { active: false }).catch(() => {});
      await remove(ref(db, `waiting/${rid}`)).catch(() => {});
      currentRoomId.current = null;
    }

    setMessages([]);
    setInput("");
    setStatus("Start chatting");
  }, []);

  useEffect(() => {
    const pRef = ref(db, `presence/${myId}`);
    set(pRef, true);
    onDisconnect(pRef).remove();

    const unsub = onValue(ref(db, "presence"), (snap) => {
      setOnlineCount(Object.keys(snap.val() || {}).length);
    });

    return () => {
      unsub();
      cleanupRoom();
      remove(pRef).catch(() => {});
    };
  }, [myId, cleanupRoom]);

  const findMatch = async () => {
    await cleanupRoom();
    setMode("chat");
    setStatus("Looking for someone...");

    const waitingSnap = await get(ref(db, "waiting"));
    let roomId: string;

    if (waitingSnap.exists()) {
      const list = waitingSnap.val();
      const firstKey = Object.keys(list)[0];
      roomId = list[firstKey].roomId;
      await remove(ref(db, `waiting/${firstKey}`));
      await startWebRTC(roomId, "answerer");
    } else {
      roomId = push(ref(db, "rooms")).key!;
      await set(ref(db, `waiting/${roomId}`), { roomId });
      onDisconnect(ref(db, `waiting/${roomId}`)).remove();
      await startWebRTC(roomId, "offerer");
    }
  };

  const startWebRTC = async (roomId: string, role: "offerer" | "answerer") => {
    currentRoomId.current = roomId;
    pcRef.current = new RTCPeerConnection(iceServers);
    const pc = pcRef.current;

    // 1. Get Local Media
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        localVideoRef.current.play().catch(() => {});
      }
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    } catch (err) {
      setStatus("Camera access denied");
      return;
    }

    // 2. Handle Remote Video (The Stranger)
    pc.ontrack = (ev) => {
      if (remoteVideoRef.current && ev.streams[0]) {
        remoteVideoRef.current.srcObject = ev.streams[0];
        remoteVideoRef.current.play().catch(() => {});
        setStatus("Connected");
      }
    };

    // 3. ICE Candidate Signaling (Split paths to fix blank video)
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        push(ref(db, `rooms/${roomId}/candidates/${role}`), ev.candidate.toJSON());
      }
    };

    const otherRole = role === "offerer" ? "answerer" : "offerer";
    addListener(
      onChildAdded(ref(db, `rooms/${roomId}/candidates/${otherRole}`), (snap) => {
        if (pc.remoteDescription) {
          pc.addIceCandidate(new RTCIceCandidate(snap.val())).catch(() => {});
        }
      })
    );

    // 4. Presence & Messages
    addListener(onChildAdded(ref(db, `rooms/${roomId}/messages`), (snap) => {
      setMessages((prev) => [...prev, snap.val()]);
    }));

    addListener(onValue(ref(db, `rooms/${roomId}/active`), (snap) => {
      if (snap.val() === false) setStatus("Stranger has disconnected");
    }));

    // 5. Handshake Logic
    const roomRef = ref(db, `rooms/${roomId}`);

    if (role === "offerer") {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await update(roomRef, { offer: { type: offer.type, sdp: offer.sdp }, active: true });

      addListener(onValue(ref(db, `rooms/${roomId}/answer`), async (snap) => {
        if (snap.exists() && !pc.remoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
        }
      }));
    } else {
      const snap = await get(roomRef);
      const data = snap.val();
      if (data?.offer) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await update(roomRef, { answer: { type: answer.type, sdp: answer.sdp }, active: true });
      }
    }
  };

  const nextChat = async () => {
    setStatus("Finding next person...");
    await cleanupRoom();
    findMatch();
  };

  const endChat = async () => {
    await cleanupRoom();
    setMode("home");
  };

  const sendMessage = () => {
    if (!input.trim() || !currentRoomId.current) return;
    push(ref(db, `rooms/${currentRoomId.current}/messages`), {
      text: input.trim(),
      uid: myId,
    });
    setInput("");
  };

  // ────────────────────────────────────────────────
  // UI Render
  // ────────────────────────────────────────────────

  if (mode === "home") {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 text-center">
        <h1 className="text-8xl md:text-[11rem] font-black text-orange-600 mb-8 tracking-tight select-none">omegle</h1>
        <p className="text-3xl md:text-5xl text-gray-800 mb-10 font-medium">talk to strangers!</p>
        <p className="text-xl text-gray-500 mb-16 font-semibold">{onlineCount} online now</p>
        <button
          onClick={findMatch}
          className="bg-orange-600 hover:bg-orange-700 text-white px-20 py-8 text-4xl font-bold rounded-lg shadow-lg transition-transform active:scale-95"
        >
          Video
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <header className="p-4 bg-white border-b border-gray-300 flex justify-between items-center shadow-sm">
        <h1 className="text-3xl font-black text-orange-600 lowercase select-none">omegle</h1>
        <div className="text-sm text-gray-600 font-bold">{onlineCount} online</div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left: Videos */}
        <div className="flex-1 flex flex-col bg-white p-4 gap-4 max-w-full md:max-w-[45%]">
          <div className="relative flex-1 bg-black border-4 border-gray-400 rounded overflow-hidden shadow-inner">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute top-3 left-3 bg-white/90 px-3 py-1 rounded text-sm font-bold text-gray-800 uppercase tracking-widest">stranger</div>
            {status !== "Connected" && (
              <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center">
                <div className="w-12 h-12 border-4 border-orange-600 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-gray-700 font-bold text-lg">{status}</p>
              </div>
            )}
          </div>

          <div className="relative flex-1 bg-black border-4 border-gray-400 rounded overflow-hidden shadow-inner">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
            <div className="absolute top-3 left-3 bg-white/90 px-3 py-1 rounded text-sm font-bold text-gray-800 uppercase tracking-widest">you</div>
          </div>
        </div>

        {/* Right: Chat */}
        <div className="w-full md:w-96 bg-white flex flex-col border-t md:border-t-0 md:border-l border-gray-300">
          <div className="p-4 border-b border-gray-300 text-gray-500 text-xs font-bold uppercase tracking-wider">{status}</div>
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-gray-50 text-sm">
            <div className="text-gray-400 italic text-[11px] mb-4">Omegle is a great way to meet new friends...</div>
            {messages.map((msg, i) => (
              <div key={i} className="break-words leading-relaxed">
                <strong className={msg.uid === myId ? "text-blue-700" : "text-red-700"}>
                  {msg.uid === myId ? "You" : "Stranger"}:
                </strong>{" "}
                <span className="text-gray-800 font-medium">{msg.text}</span>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-gray-300 flex gap-2 bg-white">
            <div className="flex flex-col gap-2">
              <button onClick={endChat} className="bg-gray-100 hover:bg-red-50 text-red-600 px-4 py-2 rounded text-xs font-black border border-gray-300 transition-colors uppercase">Stop</button>
              <button onClick={nextChat} className="bg-gray-100 hover:bg-orange-50 text-orange-600 px-4 py-2 rounded text-xs font-black border border-gray-300 transition-colors uppercase">Next</button>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              className="flex-1 bg-white border border-gray-400 rounded p-2 text-sm resize-none focus:outline-none focus:border-orange-500 min-h-[60px]"
              placeholder="Type your message..."
            />
            <button onClick={sendMessage} className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-4 py-2 rounded font-black border border-gray-400 transition-colors uppercase text-sm">Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}