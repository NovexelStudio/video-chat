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
    return () => { unsub(); cleanupRoom(); remove(pRef).catch(() => {}); };
  }, [myId, cleanupRoom]);

  const findMatch = async () => {
    await cleanupRoom();
    setMode("chat");
    setStatus("Looking for someone...");
    const waitingSnap = await get(ref(db, "waiting"));
    if (waitingSnap.exists()) {
      const list = waitingSnap.val();
      const firstKey = Object.keys(list)[0];
      const roomId = list[firstKey].roomId;
      await remove(ref(db, `waiting/${firstKey}`));
      startWebRTC(roomId, "answerer");
    } else {
      const roomId = push(ref(db, "rooms")).key!;
      await set(ref(db, `waiting/${roomId}`), { roomId });
      onDisconnect(ref(db, `waiting/${roomId}`)).remove();
      startWebRTC(roomId, "offerer");
    }
  };

  const startWebRTC = async (roomId: string, role: "offerer" | "answerer") => {
    currentRoomId.current = roomId;
    const pc = new RTCPeerConnection(iceServers);
    pcRef.current = pc;

    // Buffer for candidates that arrive before RemoteDescription is set
    const candidateQueue: any[] = [];
    let remoteDescSet = false;

    // 1. Get Local Media
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    } catch (err) {
      setStatus("Camera access denied");
      return;
    }

    // 2. Handle Remote Video
    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        remoteVideoRef.current.play().catch(() => {});
        setStatus("Connected");
      }
    };

    // 3. ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        push(ref(db, `rooms/${roomId}/candidates/${role}`), event.candidate.toJSON());
      }
    };

    const otherRole = role === "offerer" ? "answerer" : "offerer";
    addListener(onChildAdded(ref(db, `rooms/${roomId}/candidates/${otherRole}`), (snap) => {
      const cand = snap.val();
      if (remoteDescSet) {
        pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      } else {
        candidateQueue.push(cand);
      }
    }));

    const processQueue = () => {
      remoteDescSet = true;
      while (candidateQueue.length > 0) {
        pc.addIceCandidate(new RTCIceCandidate(candidateQueue.shift())).catch(() => {});
      }
    };

    // 4. Signaling (Handshake)
    const roomRef = ref(db, `rooms/${roomId}`);
    if (role === "offerer") {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await update(roomRef, { offer: { type: offer.type, sdp: offer.sdp }, active: true });

      addListener(onValue(ref(db, `rooms/${roomId}/answer`), async (snap) => {
        const answer = snap.val();
        if (answer && !pc.remoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          processQueue();
        }
      }));
    } else {
      addListener(onValue(ref(db, `rooms/${roomId}/offer`), async (snap) => {
        const offer = snap.val();
        if (offer && !pc.remoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await update(roomRef, { answer: { type: answer.type, sdp: answer.sdp } });
          processQueue();
        }
      }));
    }

    // 5. Messages
    addListener(onChildAdded(ref(db, `rooms/${roomId}/messages`), (snap) => {
      setMessages((prev) => [...prev, snap.val()]);
    }));
    addListener(onValue(ref(db, `rooms/${roomId}/active`), (snap) => {
      if (snap.val() === false) setStatus("Stranger disconnected");
    }));
  };

  const endChat = () => cleanupRoom().then(() => setMode("home"));
  const nextChat = () => cleanupRoom().then(() => findMatch());
  const sendMessage = () => {
    if (!input.trim() || !currentRoomId.current) return;
    push(ref(db, `rooms/${currentRoomId.current}/messages`), { text: input.trim(), uid: myId });
    setInput("");
  };

  if (mode === "home") {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center text-center">
        <h1 className="text-9xl font-black text-orange-600 mb-4">omegle</h1>
        <p className="text-4xl text-gray-800 mb-8">talk to strangers!</p>
        <p className="text-gray-500 mb-12">{onlineCount} online now</p>
        <button onClick={findMatch} className="bg-orange-600 text-white px-20 py-8 text-4xl font-bold rounded-lg shadow-xl active:scale-95 transition-transform">Video</button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <header className="p-4 bg-white border-b border-gray-300 flex justify-between items-center">
        <h1 className="text-3xl font-black text-orange-600 lowercase">omegle</h1>
        <div className="text-sm font-bold text-gray-600">{onlineCount} online</div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 flex flex-col p-4 gap-4 bg-white md:max-w-[45%]">
          <div className="relative flex-1 bg-black rounded border-4 border-gray-400 overflow-hidden shadow-inner">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute top-2 left-2 bg-white/80 px-2 py-0.5 rounded text-xs font-bold uppercase">Stranger</div>
            {status !== "Connected" && (
              <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center">
                <div className="w-10 h-10 border-4 border-orange-600 border-t-transparent rounded-full animate-spin mb-2" />
                <span className="font-bold text-gray-700">{status}</span>
              </div>
            )}
          </div>
          <div className="relative flex-1 bg-black rounded border-4 border-gray-400 overflow-hidden shadow-inner">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
            <div className="absolute top-2 left-2 bg-white/80 px-2 py-0.5 rounded text-xs font-bold uppercase">You</div>
          </div>
        </div>

        <div className="w-full md:w-96 bg-white border-l border-gray-300 flex flex-col">
          <div className="p-2 border-b text-[10px] text-gray-400 font-bold uppercase tracking-widest">{status}</div>
          <div className="flex-1 p-4 overflow-y-auto space-y-2 bg-gray-50 text-sm">
            {messages.map((msg, i) => (
              <div key={i} className="break-words">
                <strong className={msg.uid === myId ? "text-blue-800" : "text-red-800"}>{msg.uid === myId ? "You" : "Stranger"}: </strong>
                <span>{msg.text}</span>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-gray-300 flex gap-2">
            <div className="flex flex-col gap-1">
              <button onClick={endChat} className="bg-gray-100 border border-gray-400 px-3 py-1 text-[10px] font-bold uppercase hover:bg-red-50 text-red-600">Stop</button>
              <button onClick={nextChat} className="bg-gray-100 border border-gray-400 px-3 py-1 text-[10px] font-bold uppercase hover:bg-orange-50 text-orange-600">Next</button>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              className="flex-1 border border-gray-400 rounded p-2 text-sm focus:outline-none focus:border-orange-500 resize-none h-[60px]"
              placeholder="Type message..."
            />
            <button onClick={sendMessage} className="bg-gray-100 border border-gray-400 px-4 font-bold uppercase text-xs">Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}