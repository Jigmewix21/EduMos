package expo.modules.edumoslanserver

import android.content.Context
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

  override fun definition() = ModuleDefinition {
    Name("EduMosLanServer")

    AsyncFunction("startServer") { requestedPort: Int, payload: String, promise: Promise ->
      try {
        stopServerInternal()
        port = requestedPort
        packageJson = mergeSavedStudentChanges(JSONObject(payload))
        persistPackage()
        serverSocket = ServerSocket(port)
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

    Function("isRunning") {
      running.get()
    }

    Function("getBaseUrl") {
      val address = getWifiAddresses().firstOrNull() ?: "0.0.0.0"
      if (running.get()) "http://$address:$port" else ""
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
        removeById(participants, participant.optString("studentId", participant.optString("id")))
        participants.put(participant.put("classroomId", classroomId).put("receivedAt", System.currentTimeMillis()))
        packageJson.put("participants", participants)
        persistPackage()
        writeJson(output, 200, JSONObject().put("ok", true).put("id", participant.optString("studentId", participant.optString("id"))))
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
}
