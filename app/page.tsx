"use client";

import { useRef, useState, useEffect } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, onValue, set, push, onChildAdded, remove, update, onDisconnect, get } from "firebase/database";

const firebaseConfig = {
    apiKey: "AIzaSyCpX68nuBj2_ioYAehdYsaBxZsx7nwHeh0",
    authDomain: "video-chat-e39bf.firebaseapp.com",
    databaseURL: "https://video-chat-e39bf-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "video-chat-e39bf",
    storageBucket: "video-chat-e39bf.firebasestorage.app",
    messagingSenderId: "318016664014",
    appId: "1:318016664014:web:c1322ac800ede20174fb9f"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getDatabase(app);
const servers = { iceServers: [{ urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] }] };

export default function OmegleMobilePro() {
    const [mode, setMode] = useState<"home" | "chat">("home");
    const [messages, setMessages] = useState<{ text: string, uid: string }[]>([]);
    const [input, setInput] = useState("");
    const [isConnected, setIsConnected] = useState(false);
    const [status, setStatus] = useState("Waiting...");
    const [onlineCount, setOnlineCount] = useState(0);
    const [isStrangerTyping, setIsStrangerTyping] = useState(false);
    const [myId] = useState(() => "u_" + Math.random().toString(36).substring(7));

    const localRef = useRef<HTMLVideoElement>(null);
    const remoteRef = useRef<HTMLVideoElement>(null);
    const pc = useRef<RTCPeerConnection | null>(null);
    const currentRoomId = useRef<string | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const isProcessing = useRef(false);

    // Global Presence
    useEffect(() => {
        const pRef = ref(db, `presence/${myId}`);
        set(pRef, { online: true });
        onDisconnect(pRef).remove();
        onValue(ref(db, 'presence'), (s) => setOnlineCount(s.exists() ? Object.keys(s.val()).length : 0));
    }, [myId]);

    // Handle Typing Indicator Logic
    useEffect(() => {
        if (!currentRoomId.current || !isConnected) return;
        const typingRef = ref(db, `rooms/${currentRoomId.current}/typing/${myId}`);
        if (input.length > 0) {
            set(typingRef, true);
            onDisconnect(typingRef).remove();
        } else {
            remove(typingRef);
        }
    }, [input, isConnected]);

    const findRandomMatch = async () => {
        setMode("chat");
        setMessages([]);
        setIsConnected(false);
        setStatus("Looking for someone...");
        isProcessing.current = false;

        const waitingRef = ref(db, 'waiting');
        const snap = await get(waitingRef);
        if (snap.exists()) {
            const partnerKey = Object.keys(snap.val())[0];
            const rId = snap.val()[partnerKey].roomId;
            await remove(ref(db, `waiting/${partnerKey}`));
            startCommunication(rId, "join");
        } else {
            const rId = push(ref(db, 'rooms')).key!;
            set(ref(db, `waiting/${rId}`), { roomId: rId });
            onDisconnect(ref(db, `waiting/${rId}`)).remove();
            startCommunication(rId, "create");
        }
    };

    const startCommunication = async (roomId: string, type: "create" | "join") => {
        currentRoomId.current = roomId;
        pc.current = new RTCPeerConnection(servers);
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localRef.current) localRef.current.srcObject = stream;
        stream.getTracks().forEach(t => pc.current?.addTrack(t, stream));

        pc.current.ontrack = (e) => {
            if (remoteRef.current) remoteRef.current.srcObject = e.streams[0];
            setIsConnected(true);
            setStatus("Stranger connected!");
        };

        const roomRef = ref(db, `rooms/${roomId}`);
        if (type === "join") await update(roomRef, { active: true });

        // Listen for Stranger Typing
        onValue(ref(db, `rooms/${roomId}/typing`), (s) => {
            const typingData = s.val();
            if (typingData) {
                const typingUsers = Object.keys(typingData);
                setIsStrangerTyping(typingUsers.some(id => id !== myId));
            } else {
                setIsStrangerTyping(false);
            }
        });

        // Chat & Disconnect listeners
        onChildAdded(ref(db, `rooms/${roomId}/messages`), (s) => setMessages(p => [...p, s.val()]));
        onValue(ref(db, `rooms/${roomId}/active`), (s) => {
            if (s.val() === false && isConnected) {
                setStatus("Stranger disconnected.");
                setTimeout(nextChat, 1500);
            }
        });

        // Signaling Guard (Fixes "Stable" State Error)
        pc.current.onicecandidate = (e) => e.candidate && push(ref(db, `rooms/${roomId}/${type}Candidates`), e.candidate.toJSON());
        
        if (type === "create") {
            const offer = await pc.current.createOffer();
            await pc.current.setLocalDescription(offer);
            update(roomRef, { offer: { sdp: offer.sdp, type: offer.type }, active: "waiting" });
            onValue(roomRef, (s) => {
                const data = s.val();
                if (pc.current?.signalingState === "have-local-offer" && data?.answer && !isProcessing.current) {
                    isProcessing.current = true;
                    pc.current.setRemoteDescription(new RTCSessionDescription(data.answer));
                }
            });
        } else {
            onValue(roomRef, async (s) => {
                const data = s.val();
                if (data?.offer && pc.current?.signalingState === "stable" && !isProcessing.current) {
                    isProcessing.current = true;
                    await pc.current.setRemoteDescription(new RTCSessionDescription(data.offer));
                    const answer = await pc.current.createAnswer();
                    await pc.current.setLocalDescription(answer);
                    update(roomRef, { answer: { sdp: answer.sdp, type: answer.type } });
                }
            }, { onlyOnce: true });
        }
    };

    const nextChat = async () => {
        if (currentRoomId.current) {
            await update(ref(db, `rooms/${currentRoomId.current}`), { active: false });
            remove(ref(db, `rooms/${currentRoomId.current}`));
        }
        pc.current?.close();
        localStreamRef.current?.getTracks().forEach(t => t.stop());
        findRandomMatch();
    };

    const sendMessage = () => {
        if (!input.trim() || !currentRoomId.current) return;
        push(ref(db, `rooms/${currentRoomId.current}/messages`), { text: input, uid: myId });
        setInput("");
    };

    if (mode === "home") {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-gray-50 text-black px-6 text-center">
                <h1 className="text-5xl font-bold text-orange-600 mb-2">Omegle</h1>
                <p className="text-gray-600 mb-8 font-semibold">Talk to strangers! Online: {onlineCount}</p>
                <button onClick={findRandomMatch} className="bg-orange-500 hover:bg-orange-600 text-white text-2xl font-bold px-12 py-4 rounded-xl shadow-lg transition-transform active:scale-95">Video Chat</button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-[#f0f0f0] text-black">
            {/* Header */}
            <header className="flex justify-between items-center p-2 bg-white border-b-2 border-orange-500 shadow-sm z-10">
                <h1 className="text-2xl font-black text-orange-600">Omegle</h1>
                <div className="flex items-center gap-3">
                    <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Live</span>
                    <button onClick={() => alert("Reported.")} className="text-xs text-red-500 font-bold underline">Report</button>
                </div>
            </header>

            {/* Content Body: Vertical on Mobile, Horizontal on Desktop */}
            <main className="flex flex-col md:flex-row flex-grow overflow-hidden">
                {/* Video Area */}
                <section className="flex flex-col w-full md:w-1/2 lg:w-[40%] bg-black p-1 gap-1 h-[40%] md:h-full">
                    <div className="relative flex-grow bg-zinc-900 rounded overflow-hidden">
                        <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-cover" />
                        <div className="absolute top-2 left-2 bg-black/40 text-[10px] text-white px-2 py-0.5 rounded">Stranger</div>
                    </div>
                    <div className="relative flex-grow bg-zinc-900 rounded overflow-hidden">
                        <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
                        <div className="absolute top-2 left-2 bg-black/40 text-[10px] text-white px-2 py-0.5 rounded">You</div>
                    </div>
                </section>

                {/* Chat Area */}
                <section className="flex flex-col flex-grow bg-white md:border-l-2 border-gray-300">
                    <div className="p-2 bg-blue-50 text-[11px] text-blue-700 font-bold border-b italic">{status}</div>
                    
                    <div className="flex-grow overflow-y-auto p-3 space-y-2">
                        {messages.map((m, i) => (
                            <div key={i} className="text-sm">
                                <span className={`font-black ${m.uid === myId ? 'text-blue-600' : 'text-red-600'}`}>
                                    {m.uid === myId ? 'You:' : 'Stranger:'}
                                </span>
                                <span className="ml-2 leading-relaxed">{m.text}</span>
                            </div>
                        ))}
                        {isStrangerTyping && (
                            <div className="text-[10px] text-gray-400 font-bold animate-pulse">Stranger is typing...</div>
                        )}
                    </div>

                    {/* Bottom Control Bar */}
                    <div className="flex p-2 bg-white border-t border-gray-200 gap-2 items-end">
                        <div className="flex flex-col gap-1">
                            <button onClick={() => setMode("home")} className="bg-gray-100 border border-gray-300 px-3 py-1.5 rounded text-[10px] font-bold hover:bg-red-50">STOP</button>
                            <button onClick={nextChat} className="bg-gray-100 border border-gray-300 px-3 py-1.5 rounded text-[10px] font-bold hover:bg-blue-50">NEXT</button>
                        </div>
                        <textarea 
                            value={input} 
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                            className="flex-grow min-h-[50px] max-h-[100px] border-2 border-gray-200 p-2 rounded-lg text-sm outline-none focus:border-orange-400"
                            placeholder="Say hi!"
                        />
                        <button onClick={sendMessage} className="bg-orange-500 text-white font-black px-5 py-4 rounded-lg text-xs uppercase shadow-md hover:bg-orange-600">Send</button>
                    </div>
                </section>
            </main>
        </div>
    );
}