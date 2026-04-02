# 🗺️ Next.js Map App (React Leaflet)

A modern, interactive map application built with **Next.js** and **React Leaflet**. Users can search for any location and view it on a map with a marker.

---

## 🚀 Features

* 🔍 Search any location
* 📍 Display location on map with marker
* 🌐 Uses OpenStreetMap (no API key required)
* ⚡ Fast and responsive UI
* 📱 Mobile-friendly design
* 🔄 Dynamic map updates
* 📌 Default location (Bangalore)

---

## 🛠️ Tech Stack

* **Next.js (App Router)**
* **React**
* **React Leaflet**
* **Leaflet**
* **Tailwind CSS**
* **OpenStreetMap API (Nominatim)**

---

## 📦 Installation

Clone the repository:

```bash
git clone https://github.com/your-username/my-map.git
cd my-map
```

Install dependencies:

```bash
npm install
```

---

## ▶️ Run the Project

```bash
npm run dev
```

Open in browser:

```
http://localhost:3000
```

---

## 📁 Project Structure

```
my-map/
│── app/
│   └── page.js        # Main page
│
│── components/
│   └── Map.jsx        # Map component
│
│── public/
│── styles/
│── package.json
```

---

## ⚙️ How It Works

1. User enters a location in the search bar
2. App sends request to OpenStreetMap (Nominatim API)
3. API returns latitude & longitude
4. Map updates to the searched location
5. Marker is placed on the map

---

## ✨ Future Improvements

* 🔎 Autocomplete search suggestions
* 📍 Multiple markers support
* 🧭 Route & directions feature
* 🌙 Dark mode map
* 💾 Save favorite locations
* 📡 Live location tracking

---

## 🐛 Common Issues

### Map not showing

* Ensure Leaflet CSS is imported:

```css
@import "leaflet/dist/leaflet.css";
```

### Hydration / SSR error

* Use dynamic import with `ssr: false`

### Marker not appearing

* Ensure coordinates format is:

```js
[latitude, longitude]
```

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repo
2. Create a new branch
3. Make changes
4. Submit a pull request

---

## 📄 License

This project is open source and available under the **MIT License**.

---

## 🙌 Acknowledgements

* OpenStreetMap
* Leaflet
* React Leaflet

---

## ⭐ Support

If you like this project, give it a ⭐ on GitHub!
