package expo.modules.edumoslanserver

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiNetworkSpecifier
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.URLDecoder
import java.nio.charset.Charset
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class EduMosLanServerModule : Module() {
  private var serverSocket: ServerSocket? = null
  private val running = AtomicBoolean(false)
  private var serverThread: Thread? = null
  private var port: Int = 10000
  private var packageJson = JSONObject()
  private var wifiCallback: ConnectivityManager.NetworkCallback? = null
  private var hotspotReservation: WifiManager.LocalOnlyHotspotReservation? = null

  override fun definition() = ModuleDefinition {
    Name("EduMosLanServer")

    AsyncFunction("startServer") { requestedPort: Int, payload: String, promise: Promise ->
      try {
        stopServerInternal()
        port = requestedPort
        packageJson = mergeSavedStudentChanges(JSONObject(payload))
        persistPackage()
        serverSocket = ServerSocket(port, 150)
        running.set(true)
        serverThread = thread(start = true, name = "EduMosLanServer") {
          acceptLoop()
        }

        val addresses = getWifiAddresses()
        val firstAddress = addresses.firstOrNull() ?: "0.0.0.0"
        promise.resolve(mapOf(
          "ok" to true,
          "url" to "http://$firstAddress:$port",
          "port" to port,
          "addresses" to addresses
        ))
      } catch (error: Exception) {
        running.set(false)
        promise.reject("LAN_SERVER_START_FAILED", error.message ?: "Could not start LAN server", error)
      }
    }

    AsyncFunction("stopServer") { promise: Promise ->
      stopServerInternal()
      promise.resolve(mapOf("ok" to true))
    }

    AsyncFunction("startLocalHotspot") { promise: Promise ->
      try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
          promise.resolve(mapOf("ok" to false, "message" to "Android 8 or newer is needed for automatic local hotspot."))
          return@AsyncFunction
        }
        val context = appContext.reactContext ?: throw IllegalStateException("React context is not ready")
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        hotspotReservation?.close()
        hotspotReservation = null
        wifiManager.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
          override fun onStarted(reservation: WifiManager.LocalOnlyHotspotReservation) {
            hotspotReservation = reservation
            val config = reservation.wifiConfiguration
            promise.resolve(mapOf(
              "ok" to true,
              "ssid" to (config?.SSID ?: ""),
              "password" to (config?.preSharedKey ?: "")
            ))
          }

          override fun onStopped() {
            hotspotReservation = null
          }

          override fun onFailed(reason: Int) {
            hotspotReservation = null
            promise.resolve(mapOf("ok" to false, "message" to "Local hotspot could not start. Android reason: $reason"))
          }
        }, Handler(Looper.getMainLooper()))
      } catch (error: Exception) {
        promise.resolve(mapOf("ok" to false, "message" to (error.message ?: "Could not start local hotspot")))
      }
    }

    AsyncFunction("stopLocalHotspot") { promise: Promise ->
      hotspotReservation?.close()
      hotspotReservation = null
      promise.resolve(mapOf("ok" to true))
    }

    Function("isRunning") {
      running.get()
    }

    Function("getBaseUrl") {
      val address = getWifiAddresses().firstOrNull() ?: "0.0.0.0"
      if (running.get()) "http://$address:$port" else ""
    }

    AsyncFunction("connectToWifiNetwork") { ssid: String, password: String, promise: Promise ->
      try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
          promise.resolve(mapOf("ok" to false, "message" to "Android 10 or newer is needed for app-guided Wi-Fi connection."))
          return@AsyncFunction
        }
        val context = appContext.reactContext ?: throw IllegalStateException("React context is not ready")
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        wifiCallback?.let { existing ->
          try {
            connectivityManager.unregisterNetworkCallback(existing)
          } catch (_error: Exception) {}
        }
        val specifierBuilder = WifiNetworkSpecifier.Builder().setSsid(ssid)
        if (password.isNotBlank()) {
          specifierBuilder.setWpa2Passphrase(password)
        }
        val request = NetworkRequest.Builder()
          .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
          .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          .setNetworkSpecifier(specifierBuilder.build())
          .build()
        var settled = false
        val callback = object : ConnectivityManager.NetworkCallback() {
          override fun onAvailable(network: Network) {
            if (settled) return
            settled = true
            connectivityManager.bindProcessToNetwork(network)
            promise.resolve(mapOf("ok" to true, "message" to "Connected to $ssid"))
          }

          override fun onUnavailable() {
            if (settled) return
            settled = true
            promise.resolve(mapOf("ok" to false, "message" to "Could not connect to $ssid"))
          }
        }
        wifiCallback = callback
        connectivityManager.requestNetwork(request, callback, 30000)
      } catch (error: Exception) {
        promise.resolve(mapOf("ok" to false, "message" to (error.message ?: "Could not open Wi-Fi connection prompt")))
      }
    }
  }

  private fun acceptLoop() {
    while (running.get()) {
      try {
        val socket = serverSocket?.accept() ?: break
        thread(start = true) {
          handleClient(socket)
        }
      } catch (_error: Exception) {
        if (running.get()) {
          running.set(false)
        }
      }
    }
  }

  private fun handleClient(socket: Socket) {
    socket.use { client ->
      try {
        val reader = BufferedReader(InputStreamReader(client.getInputStream()))
        val requestLine = reader.readLine() ?: return
        val parts = requestLine.split(" ")
        val method = parts.getOrNull(0) ?: "GET"
        val path = parts.getOrNull(1)?.substringBefore("?") ?: "/"
        var contentLength = 0

        while (true) {
          val line = reader.readLine() ?: break
          if (line.isEmpty()) break
          val separator = line.indexOf(":")
          if (separator > 0 && line.substring(0, separator).equals("Content-Length", ignoreCase = true)) {
            contentLength = line.substring(separator + 1).trim().toIntOrNull() ?: 0
          }
        }

        val body = if (contentLength > 0) {
          val buffer = CharArray(contentLength)
          reader.read(buffer, 0, contentLength)
          String(buffer)
        } else {
          ""
        }

        route(client.getOutputStream(), method, URLDecoder.decode(path, "UTF-8"), body)
      } catch (error: Exception) {
        writeJson(client.getOutputStream(), 500, JSONObject().put("ok", false).put("message", error.message ?: "Server error"))
      }
    }
  }

  private fun route(output: OutputStream, method: String, path: String, body: String) {
    val classroomId = packageJson.optJSONObject("classroom")?.optString("id") ?: ""

    when {
      method == "GET" && path == "/health" -> {
        writeJson(output, 200, JSONObject().put("ok", true).put("name", "EduMos LAN Server"))
      }
      method == "GET" && path == "/api/offline/classrooms" -> {
        val classroom = packageJson.optJSONObject("classroom") ?: JSONObject()
        val sections = packageJson.optJSONArray("sections") ?: JSONArray()
        writeJson(output, 200, JSONObject().put("ok", true).put("classrooms", JSONArray().put(JSONObject()
          .put("id", classroomId)
          .put("name", classroom.optString("name", "Hosted classroom"))
          .put("enrollmentKey", classroom.optString("enrollmentKey", ""))
          .put("sections", sections.length())
          .put("resources", countNested(sections, "resources"))
          .put("quizzes", countNested(sections, "quizzes"))
        )))
      }
      method == "GET" && path == "/api/offline/classrooms/$classroomId" -> {
        writeJson(output, 200, packageJson)
      }
      method == "POST" && path == "/api/offline/classrooms/$classroomId/participants" -> {
        val participant = JSONObject(body)
        val participants = packageJson.optJSONArray("participants") ?: JSONArray()
        removeParticipantDuplicate(participants, participant)
        participants.put(participant.put("classroomId", classroomId).put("receivedAt", System.currentTimeMillis()))
        packageJson.put("participants", participants)
        persistPackage()
        writeJson(output, 200, JSONObject()
          .put("ok", true)
          .put("id", participant.optString("studentId", participant.optString("id")))
          .put("sessionId", participant.optString("sessionId")))
      }
      method == "POST" && path == "/api/offline/classrooms/$classroomId/grades" -> {
        val grade = JSONObject(body)
        val grades = packageJson.optJSONArray("grades") ?: JSONArray()
        val id = grade.optString("id", "${grade.optString("studentId")}_${grade.optString("columnName")}")
        removeById(grades, id)
        grades.put(grade.put("id", id).put("classroomId", classroomId).put("receivedAt", System.currentTimeMillis()))
        packageJson.put("grades", grades)
        persistPackage()
        writeJson(output, 200, JSONObject().put("ok", true).put("id", id))
      }
      method == "POST" && path == "/api/live/classrooms/$classroomId/question" -> {
        val question = JSONObject(body)
        question.put("classroomId", classroomId)
        question.put("publishedAt", System.currentTimeMillis())
        packageJson.put("liveQuestion", question)
        packageJson.put("liveAnswers", JSONArray())
        persistPackage()
        writeJson(output, 200, JSONObject().put("ok", true).put("question", question))
      }
      method == "GET" && path == "/api/live/classrooms/$classroomId/question" -> {
        val question = packageJson.optJSONObject("liveQuestion")
        writeJson(output, 200, JSONObject().put("ok", true).put("question", question ?: JSONObject.NULL))
      }
      method == "POST" && path == "/api/live/classrooms/$classroomId/answers" -> {
        val answer = JSONObject(body)
        val answers = packageJson.optJSONArray("liveAnswers") ?: JSONArray()
        val studentId = answer.optString("studentId")
        removeById(answers, studentId)
        answers.put(answer.put("id", studentId).put("classroomId", classroomId).put("receivedAt", System.currentTimeMillis()))
        packageJson.put("liveAnswers", answers)
        val question = packageJson.optJSONObject("liveQuestion")
        if (question != null) {
          val grades = packageJson.optJSONArray("grades") ?: JSONArray()
          val score = if (answer.optInt("answerIndex", -1) == question.optInt("correctIndex", -2)) "1/1" else "0/1"
          val gradeId = "${studentId}_${question.optString("id", "live")}"
          removeById(grades, gradeId)
          grades.put(JSONObject()
            .put("id", gradeId)
            .put("classroomId", classroomId)
            .put("studentId", studentId)
            .put("studentName", answer.optString("studentName"))
            .put("studentEmail", answer.optString("studentEmail"))
            .put("columnName", question.optString("title", "Live Quiz"))
            .put("value", score)
            .put("updatedAt", System.currentTimeMillis()))
          packageJson.put("grades", grades)
        }
        persistPackage()
        writeJson(output, 200, JSONObject().put("ok", true).put("answer", answer))
      }
      method == "GET" && path == "/api/live/classrooms/$classroomId/answers" -> {
        writeJson(output, 200, JSONObject().put("ok", true).put("answers", packageJson.optJSONArray("liveAnswers") ?: JSONArray()))
      }
      else -> {
        writeJson(output, 404, JSONObject().put("ok", false).put("message", "Not found"))
      }
    }
  }

  private fun writeJson(output: OutputStream, status: Int, json: JSONObject) {
    val body = json.toString().toByteArray(Charset.forName("UTF-8"))
    val statusText = if (status == 200) "OK" else "Error"
    val headers = "HTTP/1.1 $status $statusText\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      "Access-Control-Allow-Origin: *\r\n" +
      "Connection: close\r\n" +
      "Content-Length: ${body.size}\r\n\r\n"
    output.write(headers.toByteArray(Charset.forName("UTF-8")))
    output.write(body)
    output.flush()
  }

  private fun stopServerInternal() {
    running.set(false)
    try {
      serverSocket?.close()
    } catch (_error: Exception) {}
    serverSocket = null
  }

  private fun persistPackage() {
    val prefs = appContext.reactContext?.getSharedPreferences("edumos_lan_server", Context.MODE_PRIVATE) ?: return
    prefs.edit().putString("hosted_package", packageJson.toString()).apply()
  }

  private fun mergeSavedStudentChanges(nextPackage: JSONObject): JSONObject {
    val prefs = appContext.reactContext?.getSharedPreferences("edumos_lan_server", Context.MODE_PRIVATE) ?: return nextPackage
    val savedRaw = prefs.getString("hosted_package", null) ?: return nextPackage
    val saved = try {
      JSONObject(savedRaw)
    } catch (_error: Exception) {
      return nextPackage
    }
    val nextClassroomId = nextPackage.optJSONObject("classroom")?.optString("id") ?: ""
    val savedClassroomId = saved.optJSONObject("classroom")?.optString("id") ?: ""
    if (nextClassroomId.isEmpty() || nextClassroomId != savedClassroomId) return nextPackage

    nextPackage.put("participants", mergeArrays(saved.optJSONArray("participants"), nextPackage.optJSONArray("participants"), true))
    nextPackage.put("grades", mergeArrays(saved.optJSONArray("grades"), nextPackage.optJSONArray("grades"), false))
    return nextPackage
  }

  private fun mergeArrays(saved: JSONArray?, fresh: JSONArray?, participantMode: Boolean): JSONArray {
    val merged = JSONArray()
    val seen = mutableSetOf<String>()
    fun addItems(items: JSONArray?) {
      if (items == null) return
      for (index in 0 until items.length()) {
        val item = items.optJSONObject(index) ?: continue
        val id = if (participantMode) {
          item.optString("studentId", item.optString("id"))
        } else {
          item.optString("id")
        }
        if (id.isNotEmpty() && !seen.contains(id)) {
          seen.add(id)
          merged.put(item)
        }
      }
    }
    addItems(fresh)
    addItems(saved)
    return merged
  }

  private fun getWifiAddresses(): List<String> {
    val addresses = mutableListOf<String>()
    try {
      val interfaces = NetworkInterface.getNetworkInterfaces()
      for (networkInterface in interfaces) {
        if (!networkInterface.isUp || networkInterface.isLoopback) continue
        val inetAddresses = networkInterface.inetAddresses
        for (address in inetAddresses) {
          if (address is Inet4Address && !address.isLoopbackAddress) {
            addresses.add(address.hostAddress ?: continue)
          }
        }
      }
    } catch (_error: SocketException) {}
    return addresses
  }

  private fun countNested(sections: JSONArray, key: String): Int {
    var total = 0
    for (index in 0 until sections.length()) {
      total += sections.optJSONObject(index)?.optJSONArray(key)?.length() ?: 0
    }
    return total
  }

  private fun removeById(array: JSONArray, id: String) {
    val kept = JSONArray()
    for (index in 0 until array.length()) {
      val item = array.optJSONObject(index)
      val itemId = item?.optString("id", item.optString("studentId")) ?: ""
      if (itemId != id) kept.put(item)
    }
    for (index in array.length() - 1 downTo 0) {
      array.remove(index)
    }
    for (index in 0 until kept.length()) {
      array.put(kept.get(index))
    }
  }

  private fun removeParticipantDuplicate(array: JSONArray, participant: JSONObject) {
    val sessionId = participant.optString("sessionId")
    val studentId = participant.optString("studentId", participant.optString("id"))
    val email = participant.optString("email").trim().lowercase()
    val kept = JSONArray()
    for (index in 0 until array.length()) {
      val item = array.optJSONObject(index)
      val sameSession = sessionId.isNotEmpty() && item?.optString("sessionId") == sessionId
      val sameStudent = studentId.isNotEmpty() && item?.optString("studentId", item.optString("id")) == studentId
      val sameEmail = email.isNotEmpty() && item?.optString("email")?.trim()?.lowercase() == email
      if (!sameSession && !sameStudent && !sameEmail) kept.put(item)
    }
    for (index in array.length() - 1 downTo 0) {
      array.remove(index)
    }
    for (index in 0 until kept.length()) {
      array.put(kept.get(index))
    }
  }
}
